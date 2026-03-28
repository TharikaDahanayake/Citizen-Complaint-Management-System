/**
 * locationRoutingService.js
 * 
 * Handles location-based complaint routing:
 * - Calculates distance between two coordinates using Haversine formula
 * - Finds nearest police station from complaint location
 * - Prepares station data for complaint document
 */

/**
 * Haversine formula to calculate distance between two latitude/longitude points
 * @param {number} lat1 - Starting latitude
 * @param {number} lon1 - Starting longitude
 * @param {number} lat2 - Ending latitude
 * @param {number} lon2 - Ending longitude
 * @returns {number} - Distance in kilometers
 */
const calculateHaversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return distance;
};

/**
 * Parse stationLocation coordinates
 * Handles both array format [lat, lon] and string format "lat, lon"
 * @param {any} stationLocation - Station location data
 * @returns {object|null} - Object with latitude and longitude, or null if invalid
 */
const parseStationLocation = (stationLocation) => {
  try {
    if (!stationLocation) {
      return null;
    }

    // Handle array format [lat, lon]
    if (Array.isArray(stationLocation) && stationLocation.length >= 2) {
      return {
        latitude: parseFloat(stationLocation[0]),
        longitude: parseFloat(stationLocation[1]),
      };
    }

    // Handle GeoPoint object (Firestore GeoPoint)
    if (stationLocation.latitude !== undefined && stationLocation.longitude !== undefined) {
      return {
        latitude: parseFloat(stationLocation.latitude),
        longitude: parseFloat(stationLocation.longitude),
      };
    }

    // Handle string format "lat, lon"
    if (typeof stationLocation === 'string') {
      const parts = stationLocation.split(',').map((p) => parseFloat(p.trim()));
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return {
          latitude: parts[0],
          longitude: parts[1],
        };
      }
    }

    return null;
  } catch (error) {
    console.warn('Error parsing station location:', error);
    return null;
  }
};

/**
 * Find the nearest police station based on complaint coordinates
 * @param {array} stations - Array of station objects from police_stations collection
 * @param {number} complaintLatitude - Complaint latitude
 * @param {number} complaintLongitude - Complaint longitude
 * @returns {object|null} - Nearest station object with distance, or null if no valid stations
 */
const findNearestStation = (stations, complaintLatitude, complaintLongitude) => {
  if (!stations || stations.length === 0) {
    console.warn('No stations provided for nearest station calculation');
    return null;
  }

  if (!complaintLatitude || !complaintLongitude) {
    console.warn('Invalid complaint coordinates provided');
    return null;
  }

  let nearestStation = null;
  let minDistance = Infinity;

  stations.forEach((station) => {
    const stationCoords = parseStationLocation(station.stationLocation);

    if (!stationCoords) {
      console.warn(`Unable to parse location for station ${station.stationID}`);
      return;
    }

    const distance = calculateHaversineDistance(
      complaintLatitude,
      complaintLongitude,
      stationCoords.latitude,
      stationCoords.longitude
    );

    if (distance < minDistance) {
      minDistance = distance;
      nearestStation = {
        ...station,
        distanceInKm: parseFloat(distance.toFixed(2)),
      };
    }
  });

  return nearestStation;
};

/**
 * Build station routing info from nearest station
 * @param {object} station - Station object
 * @returns {object} - Station routing info for complaint document
 */
const buildStationRoutingInfo = (station) => {
  if (!station) {
    return {
      stationID: null,
      stationName: null,
      stationContact: null,
      stationEmail: null,
      stationProvince: null,
      stationDistrict: null,
      stationDivision: null,
      distanceToNearestStationKm: null,
      routingSource: 'location-based-routing',
    };
  }

  return {
    stationID: station.stationID || null,
    stationName: station.stationName || null,
    stationContact: station.stationContact || null,
    stationEmail: station.stationEmail || null,
    stationProvince: station.stationProvince || null,
    stationDistrict: station.stationDistrict || null,
    stationDivision: station.stationDivision || null,
    distanceToNearestStationKm: station.distanceInKm || null,
    routingSource: 'location-based-routing',
  };
};

export const locationRoutingService = {
  calculateHaversineDistance,
  parseStationLocation,
  findNearestStation,
  buildStationRoutingInfo,
};

export default locationRoutingService;
