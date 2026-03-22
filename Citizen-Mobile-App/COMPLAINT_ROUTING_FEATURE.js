/**
 * COMPLAINT ROUTING FEATURE DOCUMENTATION
 * 
 * This document describes the location-based and department-based complaint routing feature.
 * When a user submits a complaint, the system automatically:
 * 1. Routes to the NEAREST POLICE STATION based on complaint location (latitude/longitude)
 * 2. Routes to the CORRECT DEPARTMENT within that station based on complaint category
 */

/**
 * ============================================================================
 * 1. HOW IT WORKS
 * ============================================================================
 * 
 * STEP 1: AI Categorization
 * ─────────────────────────
 * - User submits complaint with description
 * - AI model predicts complaint category:
 *   • "traffic issues"
 *   • "Public Nuisance / Cleanliness"
 *   • "Neighbor / Community Issues"
 * 
 * STEP 2: Station Routing (by Location)
 * ──────────────────────────────────────
 * - System fetches all police_stations from Firestore
 * - For each station, calculates distance to complaint location using Haversine formula
 * - Selects the station with minimum distance
 * - Stores: stationID, stationName, stationContact, distanceToNearestStationKm
 * 
 * STEP 3: Department Routing (by Category)
 * ─────────────────────────────────────────
 * - Maps AI category to department name:
 *   "traffic issues" → "Traffic Division"
 *   "Public Nuisance / Cleanliness" → "Minor Offences Branch"
 *   "Neighbor / Community Issues" → "Community Policing Unit"
 * 
 * - Queries departments collection:
 *   WHERE stationID = <selected station>
 *   AND departmentName matches mapped name
 * 
 * - Returns ACTUAL departmentID from database (not hardcoded!)
 * - Stores: departmentID, department, departmentRoutingSource
 * 
 * 
 * ============================================================================
 * 2. SERVICES OVERVIEW
 * ============================================================================
 * 
 * locationRoutingService.js
 * ─────────────────────────
 * Handles geographic calculations and station matching
 * 
 * Functions:
 *   • calculateHaversineDistance(lat1, lon1, lat2, lon2)
 *     Returns distance in km between two coordinates
 *     Formula: Uses Earth radius 6371 km
 * 
 *   • parseStationLocation(stationLocation)
 *     Parses location in multiple formats:
 *     - Array: [6.8454, 79.9289]
 *     - GeoPoint: {latitude: 6.8454, longitude: 79.9289}
 *     - String: "6.8454, 79.9289"
 *     Returns: {latitude, longitude} or null
 * 
 *   • findNearestStation(stations, complaintLat, complaintLng)
 *     Input: array of station objects, complaint coordinates
 *     Output: single station object + distanceInKm
 *     Iterates through all stations, finds minimum distance
 * 
 *   • buildStationRoutingInfo(station)
 *     Formats station object for complaint document
 *     Returns object with: stationID, stationName, stationContact, 
 *                          stationEmail, stationProvince, stationDistrict,
 *                          stationDivision, distanceToNearestStationKm
 * 
 * 
 * stationDepartmentService.js
 *────────────────────────────
 * Handles department queries and database lookups
 * 
 * Functions:
 *   • getDepartmentsForStation(stationID)
 *     Queries: collection('departments') WHERE stationID == X
 *     Returns: array of department objects for that station
 * 
 *   • findDepartmentByNameInStation(departmentName, stationID)
 *     Helper: finds single department by name in a station
 *     Returns: department object or null
 *     Uses: exact match first, then partial match fallback
 * 
 *   • getDepartmentRoutingForComplaint(complaintCategory, stationID) ⭐ MAIN
 *     This is the PRIMARY function - calls during complaint submission
 *     
 *     Logic:
 *       1. Maps category to department name
 *       2. Queries departments collection for that station+name
 *       3. Returns actual departmentID from database
 *       4. Fallback: returns hardcoded ID if database lookup fails
 *     
 *     Returns: {
 *       departmentID,        // from database or fallback
 *       departmentName,
 *       stationID,
 *       routingSource,       // "database-lookup" or "database-lookup-fallback"
 *       warning/error        // if applicable
 *     }
 * 
 *   • getAllDepartments()
 *     Utility: fetches all departments (useful for debugging)
 * 
 * 
 * stationsService.js
 * ──────────────────
 * Handles police station data fetching with caching
 * 
 * Features:
 *   • 5-minute cache to reduce Firestore reads
 *   • Automatic cache expiration
 *   • Fallback to expired cache if fetch fails
 * 
 * Functions:
 *   • getAllStations(useCache = true)
 *     Fetches all police_stations from Firestore
 *     Caches results for 5 minutes
 *     Returns: array of station objects
 * 
 *   • getStationByID(stationID, useCache = true)
 *     Helper: gets single station by ID
 *     Uses cache from getAllStations()
 * 
 *   • clearStationsCache()
 *     Manual: clears cache if needed
 * 
 * 
 * ============================================================================
 * 3. DATA FLOW DIAGRAM
 * ============================================================================
 * 
 * ┌─────────────────────────────────────────────────────────────░┐
 * │ NonAnonymousComplaintSubmission.js / AnonymousComplaintSubmission.js │
 * └──────────────────┬──────────────────────────────────────────┘
 *                    │
 *        User clicks "Submit Complaint"
 *                    ↓
 *        uploadEvidenceFiles()  (existing)
 *                    ↓
 *        categorizeComplaint(description)  (existing AI model)
 *                    ↓
 *     ┌──────────────────────────────────────────────┐
 *     │ STEP 1: Station Routing (NEW)               │
 *     │                                              │
 *     │ stationsService.getAllStations()            │
 *     │   → fetches 'police_stations' collection    │
 *     │   → returns array of all stations           │
 *     │                                              │
 *     │ locationRoutingService.findNearestStation() │
 *     │   → loops through stations                  │
 *     │   → calculates distance using Haversine     │
 *     │   → returns station with min distance       │
 *     │                                              │
 *     │ locationRoutingService.buildStationRoutingInfo() │
 *     │   → formats station data for complaint doc  │
 *     └────────────┬─────────────────────────────────┘
 *                  │
 *                  ↓ nearestStation.stationID
 *     ┌──────────────────────────────────────────────┐
 *     │ STEP 2: Department Routing (NEW)            │
 *     │                                              │
 *     │ stationDepartmentService.getDepartmentRouting │
 *     │ ForComplaint(category, stationID)           │
 *     │                                              │
 *     │ A. Map category to department name          │
 *     │    "traffic issues" → "Traffic Division"    │
 *     │                                              │
 *     │ B. Query departments collection:            │
 *     │    WHERE stationID == <selected station>    │
 *     │    AND departmentName == "Traffic Division" │
 *     │                                              │
 *     │ C. Return actual departmentID from DB       │
 *     │    (NOT hardcoded!)                         │
 *     └────────────┬─────────────────────────────────┘
 *                  │ departmentID from database
 *                  ↓
 *     ┌──────────────────────────────────────────────┐
 *     │ STEP 3: Create Complaint Document           │
 *     │                                              │
 *     │ addDoc('complaints', {                       │
 *     │   title, description, incidentDate, ...     │
 *     │   complaintCategory (from AI),              │
 *     │   stationID (from location routing),        │
 *     │   stationName, stationContact, ...,         │
 *     │   departmentID (from database lookup),      │
 *     │   department,                               │
 *     │   createdAt                                 │
 *     │ })                                           │
 *     └────────────┬─────────────────────────────────┘
 *                  │
 *                  ↓ Saved to Firestore
 *        ✅ Complaint successfully routed!
 * 
 * 
 * ============================================================================
 * 4. DATABASE SCHEMA
 * ============================================================================
 * 
 * Firestore Collections:
 * 
 * police_stations
 * ───────────────
 * {
 *   stationID:        "station-001",
 *   stationName:      "Colombo Fort Police Station",
 *   stationLocation:  [6.8454, 79.9289],
 *   stationContact:   "+94112433333",
 *   stationEmail:     "fort@police.lk",
 *   stationProvince:  "Western",
 *   stationDistrict:  "Colombo",
 *   stationDivision:  "Central Division",
 *   policeOIC:        "SP John Doe",
 *   stationPassword:  "encrypted..."
 * }
 * 
 * departments
 * ──────────
 * {
 *   departmentID:    "dept-traffic-001",
 *   departmentName:  "Traffic Division",
 *   stationID:       "station-001",          // FK to police_stations
 *   createdAt:       timestamp
 * }
 * 
 * complaints (UPDATED with new fields)
 * ────────────────────────────────────
 * {
 *   title:                         "Pothole on Main Road",
 *   description:                   "Large pothole...",
 *   incidentDate:                  "2026-03-27",
 *   incidentLocation:              "Main Road, Colombo",
 *   latitude:                      6.927079,
 *   longitude:                     80.632034,
 *   
 *   // AI Categorization (existing)
 *   complaintCategory:             "traffic issues",
 *   aiConfidence:                  0.89,
 *   aiSource:                      "trained-model-api",
 *   
 *   // Station Routing (NEW)
 *   stationID:                     "station-001",           // ← by location
 *   stationName:                   "Colombo Fort Police",
 *   stationContact:                "+94112433333",
 *   stationEmail:                  "fort@police.lk",
 *   stationProvince:               "Western",
 *   stationDistrict:               "Colombo",
 *   stationDivision:               "Central Division",
 *   distanceToNearestStationKm:    2.5,
 *   
 *   // Department Routing (NEW)
 *   departmentID:                  "dept-traffic-001",      // ← by category in station
 *   department:                    "Traffic Division",
 *   departmentRoutingSource:       "database-lookup",
 *   
 *   // Other
 *   citizenID:                     "user-123",
 *   status:                        "Pending",
 *   createdAt:                     timestamp,
 *   updatedAt:                     timestamp
 * }
 * 
 * 
 * ============================================================================
 * 5. ERROR HANDLING & FALLBACKS
 * ============================================================================
 * 
 * Scenario 1: No stations in database
 * ────────────────────────────────────
 * - findNearestStation() returns null
 * - buildStationRoutingInfo(null) returns object with all null values
 * - stationDepartmentService still fetches by hardcoded fallback ID
 * Result: Complaint routes by category only (no station info)
 * 
 * 
 * Scenario 2: Invalid station location format
 * ────────────────────────────────────────────
 * - parseStationLocation() catches error, returns null
 * - Station is skipped in distance calculation
 * - Next valid station is considered
 * Log: Warning message logged to console
 * 
 * 
 * Scenario 3: Department not found in database for station
 * ──────────────────────────────────────────────────────
 * - getDepartmentRoutingForComplaint() catches missing department
 * - Falls back to hardcoded departmentID
 * - Sets routingSource: "database-lookup-fallback"
 * Result: Complaint still routes, but with fallback ID
 * Log: Warning message logged
 * 
 * 
 * Scenario 4: Firestore query fails (network error)
 * ──────────────────────────────────────────────────
 * - getAllStations() tries to use expired cache
 * - stationDepartmentService catches error, returns fallback
 * Result: Complaint routes with cached/hardcoded data
 * Log: Error message logged
 * 
 * 
 * Scenario 5: Empty complaint description
 * ────────────────────────────────────────
 * - categorizeComplaint() already validates (throws error)
 * - Not reached in routing services
 * Result: Complaint fails at AI categorization step
 * 
 * 
 * ============================================================================
 * 6. PERFORMANCE CONSIDERATIONS
 * ============================================================================
 * 
 * Firestore Queries Per Submission:
 * ─────────────────────────────────
 * 1. getAllStations()
 *    - First submission: reads 'police_stations' collection (1 read)
 *    - Subsequent submissions (within 5 min): from cache (0 reads)
 *    - Average: ~1 read per submission + cache hits
 * 
 * 2. getDepartmentRoutingForComplaint()
 *    - Calls getDepartmentsForStation()
 *    - Queries 'departments' collection (1 read)
 *    - Then searches local array (no additional reads)
 * 
 * Total reads per submission: 2 Firestore queries
 *   1. police_stations (cached after first request)
 *   2. departments (not cached, ~3-5 docs per station expected)
 * 
 * Optimization: Enable Firestore indexing on (stationID, departmentName)
 * for faster department lookups.
 * 
 * 
 * ============================================================================
 * 7. USAGE EXAMPLES
 * ============================================================================
 * 
 * Example: Complete Flow
 * ──────────────────────
 * 
 * // In NonAnonymousComplaintSubmission.js handleSubmit()
 * 
 * try {
 *   // 1. Get nearest station
 *   const allStations = await stationsService.getAllStations(true);
 *   const nearestStation = locationRoutingService.findNearestStation(
 *     allStations,
 *     6.927079,    // complaint latitude
 *     80.632034    // complaint longitude
 *   );
 *   // nearestStation = {
 *   //   stationID: "station-001",
 *   //   stationName: "Colombo Fort Police",
 *   //   stationLocation: [6.8454, 79.9289],
 *   //   distanceInKm: 2.5
 *   // }
 *   
 *   const stationInfo = locationRoutingService.buildStationRoutingInfo(nearestStation);
 *   // stationInfo.stationID: "station-001"
 *   // stationInfo.distanceToNearestStationKm: 2.5
 * 
 *   // 2. Get department for this station
 *   const deptInfo = await stationDepartmentService.getDepartmentRoutingForComplaint(
 *     "traffic issues",    // from AI categorization
 *     "station-001"        // from nearest station
 *   );
 *   // deptInfo = {
 *   //   departmentID: "dept-traffic-001",
 *   //   departmentName: "Traffic Division",
 *   //   stationID: "station-001",
 *   //   routingSource: "database-lookup"
 *   // }
 * 
 *   // 3. Save complaint
 *   await addDoc(collection(db, 'complaints'), {
 *     title: "Pothole",
 *     description: "Large pothole...",
 *     latitude: 6.927079,
 *     longitude: 80.632034,
 *     complaintCategory: "traffic issues",
 *     ...stationInfo,           // spreads stationID, stationName, distance, etc
 *     departmentID: deptInfo.departmentID,
 *     department: deptInfo.departmentName,
 *     status: "Pending",
 *     createdAt: serverTimestamp()
 *   });
 * 
 * } catch (error) {
 *   console.error('Submission error:', error);
 * }
 * 
 * 
 * ============================================================================
 * 8. TESTING CHECKLIST
 * ============================================================================
 * 
 * Location Routing:
 * ✓ Complaint with valid lat/lng routes to nearest station
 * ✓ Distance calculation shows reasonable km values
 * ✓ Multiple stations handled correctly (min distance selected)
 * ✓ Invalid station locations skipped gracefully
 * ✓ stationRoutingInfo object has all required fields
 * 
 * Department Routing:
 * ✓ "traffic issues" maps to "Traffic Division" in database
 * ✓ "Public Nuisance/Cleanliness" maps to "Minor Offences Branch"
 * ✓ "Neighbor/Community Issues" maps to "Community Policing Unit"
 * ✓ Department found by name in selected station
 * ✓ Fallback to hardcoded ID if department not found
 * ✓ departmentRoutingInfo has correct routingSource value
 * 
 * Integration:
 * ✓ Non-anonymous complaints include station + department routing
 * ✓ Anonymous complaints include station + department routing
 * ✓ stationID no longer hardcoded to null
 * ✓ departmentID from database (not hardcoded)
 * ✓ All Firestore fields populated correctly
 * 
 * Error Handling:
 * ✓ Network failure → uses cached data or fallback
 * ✓ Missing department in DB → uses hardcoded fallback
 * ✓ Invalid coordinates → graceful error message
 * ✓ No stations in DB → complaint still routes by category
 * 
 * Performance:
 * ✓ Cache hit: second submission faster than first
 * ✓ Cache expiration: automatic refresh after 5 minutes
 * ✓ Manual cache clear: allows immediate refresh if needed
 * 
 */
