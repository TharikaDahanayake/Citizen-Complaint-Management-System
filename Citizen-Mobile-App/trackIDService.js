import { db } from './firebaseConfig';
import { doc, getDoc, setDoc, runTransaction } from 'firebase/firestore';

/**
 * Initialize the trackID counter if it doesn't exist
 * Only run this once during app startup or backend setup
 */
export async function initializeTrackIDCounter() {
  try {
    const counterRef = doc(db, '_counters', 'complaints_trackID');
    const counterSnap = await getDoc(counterRef);
    
    if (!counterSnap.exists()) {
      await setDoc(counterRef, { nextID: 1 });
      console.log('TrackID counter initialized with nextID: 1');
    }
  } catch (error) {
    console.error('Error initializing trackID counter:', error);
    throw error;
  }
}

/**
 * Generate the next trackID safely using Firestore transaction
 * Returns an 8-digit padded string (e.g., "00000001")
 */
export async function generateTrackID() {
  const counterRef = doc(db, '_counters', 'complaints_trackID');
  
  try {
    const newID = await runTransaction(db, async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      
      if (!counterDoc.exists()) {
        // First complaint initializes counter atomically.
        transaction.set(counterRef, { nextID: 2 });
        return 1;
      }
      
      const currentID = counterDoc.data().nextID;
      const nextID = currentID + 1;
      
      // Safely increment the counter
      transaction.update(counterRef, { nextID });
      
      return currentID;
    });
    
    // Format as 8-digit padded string
    return String(newID).padStart(8, '0');
  } catch (error) {
    console.error('Error generating trackID:', error);
    if (error?.code === 'permission-denied') {
      throw new Error('Missing Firestore permission for _counters/complaints_trackID. Update Firestore rules to allow this write path.');
    }
    throw new Error(`Failed to generate trackID: ${error.message}`);
  }
}

/**
 * Verify that a trackID exists (for tracking purposes)
 */
export async function getTrackIDStatus(trackID) {
  try {
    const complaintsRef = doc(db, 'complaints', trackID);
    const snapshot = await getDoc(complaintsRef);
    return snapshot.exists();
  } catch (error) {
    console.error('Error checking trackID status:', error);
    return false;
  }
}
