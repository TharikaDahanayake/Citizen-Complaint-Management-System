/**
 * stationDepartmentService.js
 * 
 * Handles department queries and lookups:
 * - Fetches departments for a specific station
 * - Matches complaint category to department name
 * - Returns actual departmentID from database (not hardcoded)
 */

import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebaseConfig';

/**
 * Category to department name mapping
 * Maps AI-predicted categories to actual department names in database
 */
const CATEGORY_TO_DEPARTMENT_NAME = {
  'traffic issues': 'Traffic Division',
  'Public Nuisance / Cleanliness': 'Minor Offences Branch',
  'Neighbor / Community Issues': 'Community Policing Unit',
};

/**
 * Fallback department ID mapping (in case database lookup fails)
 */
const CATEGORY_TO_FALLBACK_DEPARTMENT_ID = {
  'traffic issues': 'traffic-division',
  'Public Nuisance / Cleanliness': 'minor-offences-branch',
  'Neighbor / Community Issues': 'community-policing-unit',
};

/**
 * Get all departments for a specific station
 * @param {string} stationID - The station ID to get departments for
 * @returns {Promise<array>} - Array of department objects from that station
 */
export const getDepartmentsForStation = async (stationID) => {
  try {
    if (!stationID) {
      throw new Error('Station ID is required to fetch departments');
    }

    const departmentsRef = collection(db, 'departments');
    const q = query(departmentsRef, where('stationID', '==', stationID));
    const querySnapshot = await getDocs(q);

    const departments = [];
    querySnapshot.forEach((doc) => {
      departments.push({
        docId: doc.id,
        ...doc.data(),
      });
    });

    console.log(`Found ${departments.length} departments for station ${stationID}`);
    return departments;
  } catch (error) {
    console.error('Error fetching departments for station:', error);
    throw error;
  }
};

/**
 * Find a specific department by name within a station
 * @param {string} departmentName - The department name to search for
 * @param {string} stationID - The station ID to search within
 * @returns {Promise<object|null>} - Department object if found, null otherwise
 */
export const findDepartmentByNameInStation = async (departmentName, stationID) => {
  try {
    if (!departmentName || !stationID) {
      throw new Error('Department name and station ID are required');
    }

    const departments = await getDepartmentsForStation(stationID);
    
    // Exact match first
    let department = departments.find(
      (dept) => dept.departmentName && dept.departmentName.toLowerCase() === departmentName.toLowerCase()
    );

    if (department) {
      console.log(`Found exact match for department: ${departmentName}`);
      return department;
    }

    // Partial/fuzzy match if no exact match
    department = departments.find(
      (dept) => dept.departmentName && dept.departmentName.toLowerCase().includes(departmentName.toLowerCase())
    );

    if (department) {
      console.log(`Found partial match for department: ${departmentName}`);
      return department;
    }

    console.warn(`Department "${departmentName}" not found in station ${stationID}`);
    return null;
  } catch (error) {
    console.error('Error finding department by name:', error);
    throw error;
  }
};

/**
 * Get department routing info based on complaint category and station
 * Matches AI-predicted category to actual database department record
 * @param {string} complaintCategory - The AI-predicted complaint category
 * @param {string} stationID - The station ID to route to
 * @returns {Promise<object>} - Department routing info with departmentID
 */
export const getDepartmentRoutingForComplaint = async (complaintCategory, stationID) => {
  try {
    if (!complaintCategory || !stationID) {
      throw new Error('Complaint category and station ID are required');
    }

    // Get expected department name from category
    const expectedDepartmentName = CATEGORY_TO_DEPARTMENT_NAME[complaintCategory];

    if (!expectedDepartmentName) {
      console.warn(`No department mapping found for category: ${complaintCategory}`);
      const fallbackId = CATEGORY_TO_FALLBACK_DEPARTMENT_ID[complaintCategory] || 'unknown';
      return {
        departmentID: fallbackId,
        department: complaintCategory,
        stationID,
        departmentRoutingSource: 'unmapped-category-fallback',
      };
    }

    // Look up the actual department record from database
    const department = await findDepartmentByNameInStation(expectedDepartmentName, stationID);

    if (department && department.departmentID && department.departmentName) {
      // Successfully found in database
      return {
        departmentID: department.departmentID,
        department: department.departmentName,
        stationID: department.stationID,
        departmentRoutingSource: 'database-lookup',
      };
    }

    // Fallback if department not found in database
    console.warn(
      `Department "${expectedDepartmentName}" not found in database for station ${stationID}. Using fallback.`
    );

    const fallbackId = CATEGORY_TO_FALLBACK_DEPARTMENT_ID[complaintCategory] || 'unknown';
    return {
      departmentID: fallbackId,
      department: expectedDepartmentName,
      stationID,
      departmentRoutingSource: 'database-lookup-fallback',
    };
  } catch (error) {
    console.error('Error getting department routing for complaint:', error);
    
    // Return safe fallback - avoid undefined values
    const fallbackId = CATEGORY_TO_FALLBACK_DEPARTMENT_ID[complaintCategory] || 'unknown';
    const fallbackName = CATEGORY_TO_DEPARTMENT_NAME[complaintCategory] || complaintCategory || 'Unknown';
    
    return {
      departmentID: fallbackId,
      department: fallbackName,
      stationID,
      departmentRoutingSource: 'error-fallback',
    };
  }
};

/**
 * Get all departments (used for debugging or admin purposes)
 * @returns {Promise<array>} - All departments from database
 */
export const getAllDepartments = async () => {
  try {
    const departmentsRef = collection(db, 'departments');
    const querySnapshot = await getDocs(departmentsRef);

    const departments = [];
    querySnapshot.forEach((doc) => {
      departments.push({
        docId: doc.id,
        ...doc.data(),
      });
    });

    return departments;
  } catch (error) {
    console.error('Error fetching all departments:', error);
    throw error;
  }
};

export const stationDepartmentService = {
  getDepartmentsForStation,
  findDepartmentByNameInStation,
  getDepartmentRoutingForComplaint,
  getAllDepartments,
};

export default stationDepartmentService;
