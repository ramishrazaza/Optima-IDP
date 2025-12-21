const express = require('express');
const router = express.Router();
const assignmentController = require('../../controllers/assignment.controller');
const authMiddleware = require('../../middleware/authMiddleware');
const roleMiddleware = require('../../middleware/roleMiddleware');

// Base path: /api/assignments

// Create Assignment (Manager/Admin only)
router.post(
    '/',
    authMiddleware,
    roleMiddleware('manager', 'admin'),
    assignmentController.createAssignment
);

// Get My Assignments (Employee)
router.get(
    '/my',
    authMiddleware,
    assignmentController.getMyAssignments
);

module.exports = router;
