/**
 * stationsService.js
 * 
 * Handles police station data fetching and caching
 */

import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebaseConfig';

let stationsCache = null;
let stationsCacheTimestamp = null;
const STATIONS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * Fetch all police stations from database
 * Includes optional caching to reduce Firestore reads
 * @param {boolean} useCache - Whether to use cached stations (default: true)
 * @returns {Promise<array>} - Array of station objects
 */
export const getAllStations = async (useCache = true) => {
  try {
    // Check if cache is still valid
    if (
      useCache &&
      stationsCache &&
      stationsCacheTimestamp &&
      Date.now() - stationsCacheTimestamp < STATIONS_CACHE_DURATION
    ) {
      console.log('Using cached stations data');
      return stationsCache;
    }

    const stationsRef = collection(db, 'police_stations');
    const querySnapshot = await getDocs(stationsRef);

    const stations = [];
    querySnapshot.forEach((doc) => {
      stations.push({
        docId: doc.id,
        ...doc.data(),
      });
    });

    // Update cache
    stationsCache = stations;
    stationsCacheTimestamp = Date.now();

    console.log(`Fetched ${stations.length} police stations from database`);
    return stations;
  } catch (error) {
    console.error('Error fetching police stations:', error);
    
    // Return cached data if available, even if expired
    if (stationsCache) {
      console.warn('Using expired cached stations due to fetch error');
      return stationsCache;
    }
    
    throw error;
  }
};

/**
 * Get a specific station by ID
 * @param {string} stationID - The station ID
 * @param {boolean} useCache - Whether to use cached stations
 * @returns {Promise<object|null>} - Station object if found
 */
export const getStationByID = async (stationID, useCache = true) => {
  try {
    if (!stationID) {
      throw new Error('Station ID is required');
    }

    const stations = await getAllStations(useCache);
    const station = stations.find((s) => s.stationID === stationID);

    return station || null;
  } catch (error) {
    console.error('Error getting station by ID:', error);
    throw error;
  }
};

/**
 * Clear the stations cache (manual flush)
 */
export const clearStationsCache = () => {
  stationsCache = null;
  stationsCacheTimestamp = null;
  console.log('Stations cache cleared');
};

export const stationsService = {
  getAllStations,
  getStationByID,
  clearStationsCache,
};

export default stationsService;
