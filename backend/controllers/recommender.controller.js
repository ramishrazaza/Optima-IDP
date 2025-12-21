const RecommenderService = require("../services/recommender.service");
const User = require("../models/user");
const Skill = require("../models/skill");
const Resource = require("../models/resource");
const PerformanceReport = require("../models/PerformanceReport");
const IDP = require("../models/idp");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "../../config/recommender-weights.json");

// EXP: Tuned Weights for Better Accuracy
const DEFAULT_WEIGHTS = {
    skill_gap: 0.30,         // Slightly reduced
    skill_relevance: 0.20,   // Reduced to make room for similarity
    difficulty_match: 0.20,
    collaborative: 0.15,     // Slightly reduced
    resource_type: 0.00,
    skill_similarity: 0.15   // ENABLED: Allow fuzzy matching for goals
};

// Helper to get company-specific weights
const getWeights = async (company) => {
    try {
        // Find the admin user for this company to get their custom weights
        const adminUser = await User.findOne({ company, role: 'admin' });

        if (adminUser && adminUser.companySettings && adminUser.companySettings.aiWeights) {
            return adminUser.companySettings.aiWeights;
        }

        // Check legacy file (for backward compatibility)
        if (fs.existsSync(CONFIG_PATH)) {
            try {
                return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
            } catch (e) {
                console.error("Error reading legacy config:", e);
            }
        }
    } catch (e) {
        console.error("Error getting weights:", e);
    }

    return DEFAULT_WEIGHTS; // Return defaults if nothing found
};

exports.getSuggestions = async (req, res) => {
    try {
        const userId = req.user._id;
        const userCompany = req.user.company;
        // Expect targetSkills in body, e.g., [{ skillId: "...", targetLevel: 5 }]
        const { targetSkills } = req.body;

        // 1. Fetch User Data (Current Skills)
        const user = await User.findById(userId).populate("skills.skillId").lean();
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Transform user skills to format expected by Python service
        // Python expects: { "skillId": "...", "level": 3 }
        const userSkills = user.skills.map(s => ({
            skillId: s.skillId._id.toString(),
            level: s.level
        }));

        // 2. Fetch User Goals (from latest IDP)
        // We want to send free-text goals to the AI for semantic matching
        const latestIdp = await IDP.findOne({
            employee: userId,
            status: { $in: ['approved', 'pending', 'draft'] }
        }).sort({ createdAt: -1 }).lean();

        const goalText = latestIdp ? latestIdp.goals : "";

        // 3. Fetch Performance Reports (for context)
        const reports = await PerformanceReport.find({ employee: userId })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();

        const performanceReports = reports.map(r => ({
            ...r,
            _id: r._id.toString()
        }));

        // 4. Fetch System Data (All Skills & Resources)
        const allSkills = await Skill.find({}).lean();

        // FILTER: Only fetch resources created by users in the SAME COMPANY
        // First, find all users in this company
        const companyUsers = await User.find({ company: userCompany }).select('_id');
        const companyUserIds = companyUsers.map(u => u._id);

        // Fetch resources created by these users OR created by system admins (if we had a super-admin concept, but here strictly company)
        const allResources = await Resource.find({
            createdBy: { $in: companyUserIds }
        }).populate("createdBy", "name").lean();

        // 5. Fetch Peer Data (Collaborative Filtering - Same Company Only)
        // Get all other users in SAME COMPANY and their approved/completed IDPs
        const allUsers = await User.find({
            _id: { $ne: userId },
            company: userCompany
        })
            .select("skills role")
            .lean();

        const allIDPs = await IDP.find({
            status: { $in: ["approved", "completed"] },
            employee: { $in: allUsers.map(u => u._id) } // Only peers from same company
        }).select("employee recommendedResources").lean();

        // Create a map of user -> used resources
        const userResourcesMap = {};
        allIDPs.forEach(idp => {
            const empId = idp.employee.toString();
            if (!userResourcesMap[empId]) userResourcesMap[empId] = new Set();
            idp.recommendedResources.forEach(rId => userResourcesMap[empId].add(rId.toString()));
        });

        const peerData = allUsers.map(peer => ({
            userId: peer._id.toString(),
            skills: peer.skills.map(s => ({
                skillId: s.skillId.toString(),
                level: s.level || 1
            })),
            resources: Array.from(userResourcesMap[peer._id.toString()] || [])
        })).filter(p => p.resources.length > 0 || p.skills.length > 0);


        // Sanitize IDs
        const formattedSkills = allSkills.map(s => ({
            ...s,
            _id: s._id.toString()
        }));

        // Sanitize IDs & Enrich Provider
        const formattedResources = allResources.map(r => ({
            ...r,
            _id: r._id.toString(),
            // IF provider is 'Unknown', use creator's name
            provider: (r.provider && r.provider !== 'Unknown') ? r.provider : (r.createdBy ? r.createdBy.name : 'Unknown'),
            skill: r.skill ? { ...r.skill, _id: r.skill.toString() } : null
        }));

        // 6. Construct Payload
        const params = await getWeights(user.company);

        const payload = {
            user_skills: userSkills,
            skills_to_improve: targetSkills || [],
            performance_reports: performanceReports,
            resources: formattedResources,
            skills: formattedSkills,
            user_skills_data: [],
            peer_data: peerData,
            limit: 10,
            persona: user.role,
            custom_weights: params,
            goal_text: goalText  // NEW: Pass goal text to AI
        };

        let aiResponse;
        try {
            // 7. Call Python Service
            console.log("Calling Python AI Service with goals:", goalText);
            aiResponse = await RecommenderService.getRecommendedResources(payload);
        } catch (aiError) {
            console.error("⚠️ Python AI Service Failed (Falling back to static list):", aiError.message);
            // FALLBACK: Return random resources if AI service is down
            const shuffled = formattedResources.sort(() => 0.5 - Math.random());
            aiResponse = {
                recommendations: shuffled.slice(0, 10).map(r => ({
                    resourceId: r._id,
                    title: r.title,
                    provider: r.provider,
                    type: r.type,
                    url: r.url,
                    duration: r.duration,
                    author: r.createdBy ? r.createdBy.name : 'Unknown'
                }))
            };
        }

        // DEDUPLICATE RESPONSE
        if (aiResponse && aiResponse.recommendations) {
            const uniqueRecs = [];
            const seenIds = new Set();

            aiResponse.recommendations.forEach(rec => {
                const rId = rec.resourceId || rec._id || rec.id;
                const originalRes = formattedResources.find(fr => fr._id === rId);

                if (originalRes && (!rec.provider || rec.provider === 'Unknown')) {
                    rec.provider = originalRes.provider;
                }

                if (rId && !seenIds.has(rId)) {
                    seenIds.add(rId);
                    uniqueRecs.push(rec);
                }
            });
            aiResponse.recommendations = uniqueRecs;
        }

        console.log(`Returning ${aiResponse.recommendations.length} recommendations.`);
        return res.status(200).json(aiResponse);

    } catch (error) {
        console.error("Controller Error:", error);
        return res.status(500).json({ message: "Failed to generate suggestions", error: error.message });
    }
};
