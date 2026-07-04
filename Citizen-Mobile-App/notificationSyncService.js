import { collection, doc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { generateAnonOwnerHash } from './anonTracking';
import { db } from './firebaseConfig';

const normalizeStatus = (value) => (value || '').toString().trim().toLowerCase();

const formatTrackID = (value) => {
  if (value === null || value === undefined) {
    return 'Not Assigned';
  }

  const normalized = value.toString().trim();
  if (!normalized) {
    return 'Not Assigned';
  }

  if (/^\d+$/.test(normalized)) {
    return normalized.padStart(8, '0').slice(-8);
  }

  return normalized;
};

const toMillis = (value) => {
  if (!value) {
    return 0;
  }

  if (typeof value?.toMillis === 'function') {
    return value.toMillis();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  if (
    typeof value === 'object' &&
    Number.isFinite(value.seconds) &&
    Number.isFinite(value.nanoseconds)
  ) {
    return (value.seconds * 1000) + Math.floor(value.nanoseconds / 1000000);
  }

  return 0;
};

const buildOfficerMap = (officerDocuments) => {
  const map = new Map();

  officerDocuments.forEach((documentSnapshot) => {
    const data = documentSnapshot.data() || {};
    const officerStationId = (data.stationID || data.stationId || '').toString().trim();
    const idCandidates = [
      documentSnapshot.id,
      data.officerID,
      data.officerId,
      data.id,
    ]
      .filter(Boolean)
      .map((value) => value.toString().trim());

    idCandidates.forEach((id) => {
      const existing = map.get(id) || [];
      existing.push({
        officerID: id,
        stationID: officerStationId,
        officerName: data.officerName || data.name || data.fullName || 'Assigned Officer',
      });
      map.set(id, existing);
    });
  });

  return map;
};

const findOfficerByIdAndStation = (officerMap, officerID, stationID) => {
  if (!officerID) {
    return null;
  }

  const matches = officerMap.get(officerID) || [];
  if (matches.length === 0) {
    return null;
  }

  if (stationID) {
    const exactStationMatch = matches.find((officer) => officer.stationID === stationID);
    if (exactStationMatch) {
      return exactStationMatch;
    }

    return null;
  }

  return matches[0];
};

const buildNotificationMessage = (complaint) => {
  const trackID = complaint.trackID || 'Not Assigned';
  const status = normalizeStatus(complaint.status);

  if (status.includes('pending') || !status) {
    const stationName = complaint.stationName || 'police station';
    return `Your complaint ${trackID} has been received and assigned to the ${stationName}.`;
  }

  if (status.includes('ongoing') || status.includes('progress')) {
    const officerName = complaint.officerName || 'Assigned Officer';
    return `Your complaint ${trackID} has been assigned to Officer ${officerName} for investigation.`;
  }

  if (status.includes('escalat')) {
    return `Your complaint ${trackID} has been escalated to a higher authority for further action.`;
  }

  if (status.includes('resolved')) {
    return `Your complaint ${trackID} has been resolved.`;
  }

  return `Your complaint ${trackID} has been updated.`;
};

const buildNotificationKey = (complaintId, complaintStatus) => {
  const normalizedComplaintStatus = normalizeStatus(complaintStatus) || 'pending';
  return `${complaintId}_${normalizedComplaintStatus}`;
};

const buildNotificationPayload = ({ complaint, complaintId, complaintStatus, officerName, stationName }) => {
  const trackID = formatTrackID(complaint.trackID);
  const notificationKey = buildNotificationKey(complaintId, complaintStatus);
  const notificationTimeMs = toMillis(complaint.updatedAt) || toMillis(complaint.createdAt);

  return {
    notificationKey,
    complaintId,
    trackID,
    complaintStatus: normalizeStatus(complaintStatus) || 'pending',
    status: 'UNREAD',
    message: buildNotificationMessage({
      trackID,
      status: complaintStatus,
      stationName,
      officerName,
    }),
    stationName: stationName || 'police station',
    officerName: officerName || 'Assigned Officer',
    notificationTimeMs,
    createdAtMs: toMillis(complaint.createdAt),
    updatedAtMs: toMillis(complaint.updatedAt),
  };
};

export async function syncNotificationsForCitizen(citizenId) {
  if (!citizenId) {
    return [];
  }

  const anonOwnerHash = await generateAnonOwnerHash(citizenId);

  const nonAnonymousComplaintsQuery = query(
    collection(db, 'complaints'),
    where('citizenID', '==', citizenId)
  );
  const anonymousComplaintsQuery = query(
    collection(db, 'complaints'),
    where('anonOwnerHash', '==', anonOwnerHash)
  );

  const [nonAnonymousSnapshot, anonymousSnapshot, officersSnapshot] = await Promise.all([
    getDocs(nonAnonymousComplaintsQuery),
    getDocs(anonymousComplaintsQuery),
    getDocs(collection(db, 'officers')),
  ]);

  const [existingNotificationSnapshot, existingAnonymousNotificationSnapshot] = await Promise.all([
    getDocs(query(collection(db, 'notifications'), where('citizenID', '==', citizenId))),
    getDocs(query(collection(db, 'notifications'), where('anonOwnerHash', '==', anonOwnerHash))),
  ]);

  const complaintMap = new Map();
  nonAnonymousSnapshot.docs.forEach((documentSnapshot) => {
    complaintMap.set(documentSnapshot.id, documentSnapshot);
  });
  anonymousSnapshot.docs.forEach((documentSnapshot) => {
    complaintMap.set(documentSnapshot.id, documentSnapshot);
  });

  const officerMap = buildOfficerMap(officersSnapshot.docs);
  const notificationMap = new Map();

  existingNotificationSnapshot.docs.forEach((documentSnapshot) => {
    const data = documentSnapshot.data() || {};
    const key = (data.notificationKey || documentSnapshot.id).toString().trim();
    notificationMap.set(key, {
      id: documentSnapshot.id,
      ...data,
    });
  });

  existingAnonymousNotificationSnapshot.docs.forEach((documentSnapshot) => {
    const data = documentSnapshot.data() || {};
    const key = (data.notificationKey || documentSnapshot.id).toString().trim();
    notificationMap.set(key, {
      id: documentSnapshot.id,
      ...data,
    });
  });

  const notificationCandidates = Array.from(complaintMap.values()).map((documentSnapshot) => {
    const data = documentSnapshot.data() || {};
    const complaintOfficerId = (data.officerID || '').toString().trim();
    const complaintStationId = (data.stationID || data.stationId || '').toString().trim();
    const matchedOfficer = findOfficerByIdAndStation(
      officerMap,
      complaintOfficerId,
      complaintStationId
    );

    return buildNotificationPayload({
      complaint: {
        ...data,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      },
      complaintId: documentSnapshot.id,
      complaintStatus: data.status || data.complaintStatus || 'Pending',
      stationName: data.stationName || 'police station',
      officerName: matchedOfficer?.officerName || data.officerName || 'Assigned Officer',
    });
  });

  const missingNotificationWrites = notificationCandidates
    .filter((candidate) => !notificationMap.has(candidate.notificationKey))
    .map((candidate) => setDoc(
      doc(db, 'notifications', candidate.notificationKey),
      {
        notificationKey: candidate.notificationKey,
        complaintId: candidate.complaintId,
        citizenID: citizenId,
        anonOwnerHash,
        trackID: candidate.trackID,
        complaintStatus: candidate.complaintStatus,
        status: 'UNREAD',
        message: candidate.message,
        stationName: candidate.stationName,
        officerName: candidate.officerName,
        notificationTimeMs: candidate.notificationTimeMs,
        createdAtMs: candidate.createdAtMs,
        updatedAtMs: candidate.updatedAtMs,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ));

  if (missingNotificationWrites.length > 0) {
    await Promise.all(missingNotificationWrites);
  }

  const nextNotifications = notificationCandidates.map((candidate) => {
    const existingNotification = notificationMap.get(candidate.notificationKey);
    const readStatus = (existingNotification?.status || '').toString().trim().toUpperCase() || 'UNREAD';

    return {
      id: existingNotification?.id || candidate.notificationKey,
      notificationKey: candidate.notificationKey,
      complaintId: candidate.complaintId,
      trackID: candidate.trackID,
      complaintStatus: candidate.complaintStatus,
      status: readStatus,
      message: candidate.message,
      stationName: candidate.stationName,
      officerName: candidate.officerName,
      notificationTimeMs: existingNotification?.notificationTimeMs || candidate.notificationTimeMs,
      createdAtMs: existingNotification?.createdAtMs || candidate.createdAtMs,
      updatedAtMs: existingNotification?.updatedAtMs || candidate.updatedAtMs,
    };
  });

  nextNotifications.sort((a, b) => {
    const bTime = b.notificationTimeMs || b.updatedAtMs || b.createdAtMs || 0;
    const aTime = a.notificationTimeMs || a.updatedAtMs || a.createdAtMs || 0;
    return bTime - aTime;
  });

  return nextNotifications;
}