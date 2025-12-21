"""
Recommendation Router
--------------------
FastAPI router for handling recommendation requests.
Provides endpoints for:
- Getting personalized resource recommendations
- Finding similar skills
- Getting recommendations based on IDP data
"""

from fastapi import APIRouter, HTTPException, Body
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import sys
import os

# Add parent directory to path to import core modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.preprocessing import DataPreprocessor
from core.skill_similarity import SkillSimilarityCalculator
from core.resource_ranker import ResourceRanker

# Initialize router
router = APIRouter(prefix="/recommend", tags=["recommendations"])

# Initialize core components (these will be reused across requests)
preprocessor = DataPreprocessor()
similarity_calculator = SkillSimilarityCalculator()
resource_ranker = ResourceRanker()


# Pydantic models for request/response validation
class RecommendationRequest(BaseModel):
    """Request model for getting recommendations."""
    user_skills: List[Dict[str, Any]]  # User's current skills with levels
    skills_to_improve: Optional[List[Dict[str, Any]]] = []  # Skills from IDP
    performance_reports: Optional[List[Dict[str, Any]]] = []  # Performance data
    resources: List[Dict[str, Any]]  # All available resources
    skills: List[Dict[str, Any]]  # All skills in the system
    user_skills_data: Optional[List[List[Dict[str, Any]]]] = []  # Legacy co-occurrence data
    peer_data: Optional[List[Dict[str, Any]]] = []  # NEW: Peer skills and resources for Collaborative Filtering
    custom_weights: Optional[Dict[str, float]] = None  # NEW: Dynamic weights from admin panel
    limit: Optional[int] = 10  # Number of recommendations to return
    persona: Optional[str] = None  # Persona identifier (e.g., 'manager', 'tech_lead')
    goal_text: Optional[str] = None # NEW: Smart Goal text (e.g. "I want to be a full stack dev")


class SimilarSkillsRequest(BaseModel):
    """Request model for finding similar skills."""
    skill_id: str  # Target skill ID
    skills: List[Dict[str, Any]]  # All skills in the system
    user_skills_data: Optional[List[List[Dict[str, Any]]]] = []  # For co-occurrence
    top_k: Optional[int] = 5  # Number of similar skills to return


@router.post("/resources", response_model=Dict[str, Any])
async def get_resource_recommendations(request: RecommendationRequest):
    """
    Get personalized resource recommendations for a user.
    
    This endpoint:
    1. Analyzes user's current skills and skill gaps
    2. Calculates skill similarities
    3. Ranks resources based on multiple factors
    4. Returns top N recommendations
    
    Args:
        request: RecommendationRequest containing user data and resources
        
    Returns:
        Dictionary with:
        - recommendations: List of ranked resources with scores
        - skills_to_improve: Extracted skills that need improvement
        - total_count: Total number of recommendations
    """
    try:
        # Step 1: Preprocess data
        # Extract skills that need improvement from IDP data
        skills_to_improve = request.skills_to_improve
        
        # If performance reports are provided, extract weaknesses
        if request.performance_reports:
            weakness_skill_ids = preprocessor.extract_weaknesses_from_performance(
                request.performance_reports
            )
            # Add these to skills_to_improve if not already present
            existing_ids = {s.get('skillId') for s in skills_to_improve}
            for skill_id in weakness_skill_ids:
                if skill_id not in existing_ids:
                    skills_to_improve.append({
                        'skillId': skill_id,
                        'gap': 0.5  # Default gap for performance-identified weaknesses
                    })
        
        # Step 2: Create skill mapping for similarity calculations
        skill_mapping = preprocessor.create_skill_mapping(request.skills)
        
        # Step 3: Build similarity matrix (if we have user data for co-occurrence)
        similarity_matrix = None
        if request.user_skills_data:
            similarity_matrix = similarity_calculator.build_similarity_matrix(
                request.skills,
                request.user_skills_data
            )
            
        # Step 3.5: Process Free-Text Goals (Smart Goals)
        # If user has a text goal like "Learn Full Stack", find relevant skills
        if request.goal_text:
            print(f"Processing goal text: {request.goal_text}")
            # Find skills similar to the goal text
            # We treat the goal text as a "skill" for vector search
            similar_to_goal = similarity_calculator.find_similar_skills_by_text(
                request.goal_text, 
                request.skills, 
                top_k=3
            )
            
            existing_ids = {s.get('skillId') for s in skills_to_improve}
            for skill in similar_to_goal:
                skill_id = str(skill.get('_id', ''))
                if skill_id not in existing_ids:
                    print(f"Adding implied skill from goal: {skill.get('name')}")
                    skills_to_improve.append({
                        'skillId': skill_id,
                        'gap': 0.8  # High priority for goal-derived skills
                    })
        
        # Step 4: Prepare resource features
        resource_features = preprocessor.prepare_resource_features(request.resources)
        
        # Step 5: Rank resources using local engine
        ranked_resources = resource_ranker.rank_resources(
            resources=request.resources,
            user_skills=request.user_skills,
            skills_to_improve=skills_to_improve,
            resource_features=resource_features,
            similarity_matrix=similarity_matrix,
            skill_to_idx=skill_mapping,
            peer_data=request.peer_data,  # Pass peer data
            custom_weights=request.custom_weights,  # Pass dynamic weights
            persona=getattr(request, "persona", None)
        )
        
        # Step 6: Limit results and format response
        limited_results = ranked_resources[:request.limit]
        
        # Format response (remove full resource objects, keep IDs and scores)
        formatted_recommendations = []
        for item in limited_results:
            resource = item['resource']
            formatted_recommendations.append({
                'resourceId': str(resource.get('_id', '')),
                'title': resource.get('title', ''),
                'type': resource.get('type', ''),
                'difficulty': resource.get('difficulty', ''),
                'skill': {
                    'id': str(resource.get('skill', {}).get('_id', '')),
                    'name': resource.get('skill', {}).get('name', '')
                },
                'score': round(item['score'], 4),
                'scoreBreakdown': {
                    'reason': item['breakdown'].get('reason', ''),
                    'skill_gap': round(item['breakdown'].get('skill_gap', 0), 4),
                    'skill_relevance': round(item['breakdown'].get('skill_relevance', 0), 4),
                    'difficulty_match': round(item['breakdown'].get('difficulty_match', 0), 4),
                    'resource_type': round(item['breakdown'].get('resource_type', 0), 4),
                    'skill_similarity': round(item['breakdown'].get('skill_similarity', 0), 4)
                },
                'url': resource.get('url', ''),
                'provider': resource.get('provider', 'Unknown')
            })
        
        return {
            'recommendations': formatted_recommendations,
            'skills_to_improve': skills_to_improve,
            'total_count': len(ranked_resources),
            'returned_count': len(formatted_recommendations)
        }
        
    except Exception as e:
        # Log error and return appropriate HTTP error
        print(f"Error in get_resource_recommendations: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate recommendations: {str(e)}"
        )


@router.post("/similar-skills", response_model=Dict[str, Any])
async def get_similar_skills(request: SimilarSkillsRequest):
    """
    Find skills similar to a given skill.
    
    Uses multiple similarity metrics:
    - Category matching
    - Keyword similarity (Jaccard)
    - Co-occurrence patterns
    
    Args:
        request: SimilarSkillsRequest with target skill and system skills
        
    Returns:
        Dictionary with:
        - similar_skills: List of similar skills with similarity scores
        - target_skill: Information about the target skill
    """
    try:
        # Build similarity matrix
        similarity_matrix = similarity_calculator.build_similarity_matrix(
            request.skills,
            request.user_skills_data or []
        )
        
        # Create skill mapping
        skill_mapping = preprocessor.create_skill_mapping(request.skills)
        
        # Find similar skills
        similar_skills = similarity_calculator.get_similar_skills(
            skill_id=request.skill_id,
            similarity_matrix=similarity_matrix,
            skill_to_idx=skill_mapping,
            top_k=request.top_k
        )
        
        # Find target skill info
        target_skill = None
        for skill in request.skills:
            if str(skill.get('_id', '')) == request.skill_id:
                target_skill = {
                    'id': str(skill.get('_id', '')),
                    'name': skill.get('name', ''),
                    'category': skill.get('category', ''),
                    'description': skill.get('description', '')
                }
                break
        
        if not target_skill:
            raise HTTPException(
                status_code=404,
                detail=f"Skill with ID {request.skill_id} not found"
            )
        
        # Format similar skills with full skill info
        formatted_similar = []
        for sim_skill in similar_skills:
            skill_id = sim_skill['skillId']
            for skill in request.skills:
                if str(skill.get('_id', '')) == skill_id:
                    formatted_similar.append({
                        'id': skill_id,
                        'name': skill.get('name', ''),
                        'category': skill.get('category', ''),
                        'similarity': sim_skill['similarity']
                    })
                    break
        
        return {
            'target_skill': target_skill,
            'similar_skills': formatted_similar,
            'count': len(formatted_similar)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in get_similar_skills: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to find similar skills: {str(e)}"
        )


@router.get("/health")
async def health_check():
    """
    Health check endpoint to verify the recommendation service is running.
    
    Returns:
        Dictionary with status information
    """
    return {
        'status': 'healthy',
        'service': 'recommendation-service',
        'version': '1.0.0'
    }

