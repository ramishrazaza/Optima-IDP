import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import ConfirmationModal from '../components/Modals/ConfirmationModal';
import FeedbackModal from '../components/Modals/FeedbackModal';
import CreateAssignmentModal from '../components/Modals/CreateAssignmentModal';
import QuickStats from '../components/QuickStats';
import { WelcomeBanner, ActivityFeedItem } from '../components/DashboardWidgets';
import Announcements from '../components/Announcements';
import { CheckCircle, Clock, XCircle, User } from 'lucide-react';

// =================================================================================================
// Manager Dashboard Component
// -------------------------------------------------------------------------------------------------
// Primary dashboard for managers to view team performance, approve IDPs, and manage their team.
// Features:
// - Overview stats (QuickStats)
// - Pending IDP Approvals list
// - Team Members overview
// - Announcements sidebar
// - Quick actions for team management
// =================================================================================================

const ManagerDashboard = ({ user }) => {
    // =================================================================================================
    // State Definitions
    // -------------------------------------------------------------------------------------------------
    // Manages local state for dashboard data and UI controls.

    // Dashboard Data
    const [metrics, setMetrics] = useState(null);
    const [pendingIDPs, setPendingIDPs] = useState([]);
    const [announcements, setAnnouncements] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    // Alert State (Modal Configuration)
    const [alertConfig, setAlertConfig] = useState({
        isOpen: false,
        title: '',
        message: '',
        showCancel: false,
        confirmText: 'OK'
    });

    const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false);

    // Feedback Modal State
    const [feedbackConfig, setFeedbackConfig] = useState({
        isOpen: false,
        idpId: null,
        status: null
    });
    // State Definitions ends here

    // =================================================================================================
    // Helper Functions: UI & Interaction
    // -------------------------------------------------------------------------------------------------

    // Shows a generic alert modal
    const showAlert = (title, message) => {
        setAlertConfig({
            isOpen: true,
            title,
            message,
            showCancel: false,
            confirmText: 'OK'
        });
    };

    // =================================================================================================
    // Data Fetching Effect
    // -------------------------------------------------------------------------------------------------
    // Fetches all necessary dashboard data on component mount:
    // - Team Metrics
    // - Pending IDPs for review
    // - Team Member list
    // - System Announcements
    useEffect(() => {
        const fetchData = async () => {
            try {
                const [metricsRes, idpRes, teamRes, annRes] = await Promise.all([
                    api.get('/idp/metrics/team'),
                    api.get('/idp/pending'),
                    api.get('/user/my-team'),
                    api.get('/announcements')
                ]);
                setMetrics({ ...metricsRes.data, teamMembers: teamRes.data.team });
                setPendingIDPs(idpRes.data.idps || []);
                setAnnouncements(annRes.data || []);
            } catch (err) {
                console.error("Manager fetch error", err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);
    // Data Fetching Effect ends here

    // =================================================================================================
    // Action Handlers
    // -------------------------------------------------------------------------------------------------

    // Prepares the action: either approves immediately or opens feedback modal for revisions
    const handleAction = (idpId, status) => {
        if (status === 'approved') {
            submitAction(idpId, status, "Approved by manager");
        } else {
            setFeedbackConfig({
                isOpen: true,
                idpId,
                status
            });
        }
    };

    // Submits the final decision to the API
    const submitAction = async (idpId, status, feedback) => {
        try {
            await api.put(`/idp/approve/${idpId}`, { status, managerFeedback: feedback });
            setPendingIDPs(prev => prev.filter(p => p._id !== idpId));
            setFeedbackConfig({ isOpen: false, idpId: null, status: null });
            showAlert("Success", `IDP ${status === 'needs_revision' ? 'returned for revision' : 'updated'}`);
        } catch (err) {
            console.error(err);
            showAlert("Error", "Action failed");
        }
    };
    // Action Handlers ends here

    if (loading) return <div>Loading...</div>;

    return (

        <div className="space-y-8 fade-in">
            {/* ======================= Welcome Banner Component ======================= */}
            <WelcomeBanner user={user} role="manager" pendingCount={pendingIDPs.length} />

            {/* ======================= Quick Stats Component ======================= */}
            <QuickStats role="manager" metrics={metrics} />

            <div className="flex flex-col lg:flex-row gap-8">
                {/* ================================================================================================= */}
                {/* Main Content Area (Left - 66%) */}
                {/* Contains the primary lists: Pending Reviews and Team Members */}
                <div className="w-full lg:w-2/3 space-y-8">

                    {/* ================================================================================================= */}
                    {/* Pending Approvals Section */}
                    {/* List of IDPs waiting for manager review */}
                    <div id="approvals" className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-bold text-white">IDP Review Requests</h3>
                            <span className="bg-amber-500/10 text-amber-400 px-3 py-1 rounded-full text-sm font-medium">{pendingIDPs.length} Pending</span>
                        </div>

                        {pendingIDPs.length === 0 ? (
                            <div className="text-center py-10 text-slate-500 italic">All caught up! No pending reviews.</div>
                        ) : (
                            <div className="space-y-4">
                                {pendingIDPs.map(idp => (
                                    <div key={idp._id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold">
                                                    {idp.employee?.name?.[0] || 'U'}
                                                </div>
                                                <div>
                                                    <h4 className="font-semibold text-white">{idp.employee?.name}</h4>
                                                    <p className="text-xs text-slate-400">{new Date(idp.createdAt).toLocaleDateString()}</p>
                                                </div>
                                            </div>
                                            <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded uppercase tracking-wider">{idp.status}</span>
                                        </div>

                                        <div className="mb-4">
                                            <p className="text-sm text-slate-300 mb-2 font-medium">Goal Focus:</p>
                                            <div className="flex flex-wrap gap-2">
                                                {idp.skillsToImprove?.map((s, i) => (
                                                    <span key={i} className="text-xs bg-purple-500/10 text-purple-300 border border-purple-500/20 px-2 py-1 rounded">
                                                        {s.skill?.name}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="flex gap-3 pt-3 border-t border-slate-700/50">
                                            <a href={`/idp/${idp._id}`} className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors text-center flex items-center justify-center">
                                                View Details
                                            </a>
                                            <button onClick={() => handleAction(idp._id, 'approved')} className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors">Approve</button>
                                            <button onClick={() => handleAction(idp._id, 'needs_revision')} className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors">Request Changes</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    {/* Pending Approvals Section ends here */}

                    {/* ================================================================================================= */}
                    {/* Team Members Widget */}
                    {/* Displays cards for each team member with quick stats */}
                    <div id="team-analytics" className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-white">My Team</h3>
                            <button className="text-sm text-purple-400 hover:text-purple-300 font-medium transition-colors">
                                View All
                            </button>
                        </div>

                        {loading ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse">
                                {[1, 2, 3, 4].map(i => <div key={i} className="h-20 bg-slate-800 rounded-lg"></div>)}
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {metrics?.teamMembers?.length > 0 ? (
                                    metrics.teamMembers.map(member => (
                                        <div key={member._id} className="flex items-center gap-4 p-4 rounded-xl bg-slate-800/40 border border-slate-800 hover:bg-slate-800 hover:border-slate-700 transition-all cursor-pointer group">
                                            <div className="w-12 h-12 rounded-full bg-slate-700 overflow-hidden shrink-0 border-2 border-slate-600 group-hover:border-purple-500 transition-colors">
                                                {member.avatar ? (
                                                    <img src={member.avatar} alt={member.name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-sm font-bold text-slate-400">
                                                        {member.name?.[0]}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h4 className="font-bold text-white group-hover:text-purple-300 transition-colors truncate">{member.name}</h4>
                                                <p className="text-xs text-slate-400 truncate">{member.email}</p>
                                                <div className="flex gap-2 mt-2">
                                                    <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20">
                                                        {member.totalIDPs || 0} IDPs
                                                    </span>
                                                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">
                                                        {member.completedGoals || 0} Goals
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="col-span-full text-center py-8 text-slate-500 bg-slate-800/30 rounded-xl border border-dashed border-slate-800">
                                        No direct reports found.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    {/* Team Members Widget ends here */}
                </div>
                {/* Main Content Area ends here */}


                {/* ================================================================================================= */}
                {/* Right Sidebar (Right - 33%) */}
                {/* Contains secondary widgets: Announcements and Shortcuts */}
                <div className="w-full lg:w-1/3 space-y-8">

                    {/* ======================= Announcements Component ======================= */}
                    <Announcements
                        role="manager"
                        announcements={announcements}
                        onRefresh={() => {
                            api.get('/announcements').then(res => setAnnouncements(res.data));
                        }}
                    />


                    {/* ================================================================================================= */}
                    {/* Team Shortcuts Section */}
                    {/* Quick navigation to common management tools */}
                    <div id="team" className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                        <h3 className="text-lg font-bold text-white mb-4">Team Shortcuts</h3>
                        <div id="reviews" className="space-y-2">
                            <button
                                onClick={() => navigate("/manager/analytics")}
                                className="w-full text-left p-3 bg-slate-800/50 hover:bg-purple-600/30 border border-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors text-sm"
                            >
                                View Team Analytics
                            </button>
                            <button
                                onClick={() => {
                                    if (!metrics?.teamMembers?.length) return showAlert("Info", "No team data to export.");

                                    const headers = "Name,Email,Weekly Assigned IDPs,Weekly Completed Goals\n";
                                    const rows = metrics.teamMembers.map(m =>
                                        `"${m.name}","${m.email}",${m.weeklyCreatedIDPs || 0},${m.weeklyCompletedGoals || 0}`
                                    ).join("\n");

                                    const blob = new Blob([headers + rows], { type: 'text/csv' });
                                    const url = window.URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `Weekly_Report_${new Date().toISOString().split('T')[0]}.csv`;
                                    a.click();
                                    window.URL.revokeObjectURL(url);
                                    showAlert("Success", "Weekly Report downloaded successfully.");
                                }}
                                className="w-full text-left p-3 bg-slate-800/50 hover:bg-purple-600/30 border border-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors text-sm"
                            >
                                Generate Weekly Report
                            </button>
                            <button
                                onClick={() => navigate("/manager/performance")}
                                className="w-full text-left p-3 bg-slate-800/50 hover:bg-purple-600/30 border border-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors text-sm"
                            >
                                Performance Reviews
                            </button>
                            <button
                                onClick={() => setIsAssignmentModalOpen(true)}
                                className="w-full text-left p-3 bg-slate-800/50 hover:bg-purple-600/30 border border-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors text-sm font-medium text-purple-400"
                            >
                                Assign Mandatory Training
                            </button>
                        </div>
                    </div>
                    {/* Team Shortcuts Section ends here */}
                </div>
                {/* Right Sidebar ends here */}
            </div>

            {/* ======================= Confirmation Modal Component ======================= */}
            <ConfirmationModal
                isOpen={alertConfig.isOpen}
                onClose={() => setAlertConfig({ ...alertConfig, isOpen: false })}
                onConfirm={() => setAlertConfig({ ...alertConfig, isOpen: false })}
                title={alertConfig.title}
                message={alertConfig.message}
                showCancel={alertConfig.showCancel}
                confirmText={alertConfig.confirmText}
            />

            {/* ======================= Feedback Modal Component ======================= */}
            <FeedbackModal
                isOpen={feedbackConfig.isOpen}
                onClose={() => setFeedbackConfig({ ...feedbackConfig, isOpen: false })}
                onConfirm={(feedback) => submitAction(feedbackConfig.idpId, feedbackConfig.status, feedback)}
                title={feedbackConfig.status === 'needs_revision' ? "Request Changes" : "Provide Feedback"}
                placeholder="Explain what needs to be improved..."
            />


            <CreateAssignmentModal
                isOpen={isAssignmentModalOpen}
                onClose={() => setIsAssignmentModalOpen(false)}
                teamMembers={metrics?.teamMembers || []}
            />
        </div>
    );
};

export default ManagerDashboard;
