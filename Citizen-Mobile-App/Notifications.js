import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { collection, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { generateAnonOwnerHash } from './anonTracking';
import { db } from './firebaseConfig';

const normalizeStatus = (value) => (value || '').toString().trim().toLowerCase();
const normalizeReadStatus = (value) => (value || '').toString().trim().toUpperCase();

const buildNotificationKey = (complaintId, complaintStatus) => {
  const normalizedComplaintStatus = normalizeStatus(complaintStatus) || 'pending';
  return `${complaintId}_${normalizedComplaintStatus}`;
};

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

export default function Notifications({ citizen }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);

  const citizenId = useMemo(
    () => citizen?.citizenUid || citizen?.citizenID || '',
    [citizen]
  );

  useEffect(() => {
    const loadNotifications = async () => {
      if (!citizenId) {
        setNotifications([]);
        return;
      }

      setLoading(true);

      try {
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

          const createdAtMs = toMillis(data.createdAt);
          const updatedAtMs = toMillis(data.updatedAt);

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
          const readStatus = normalizeReadStatus(existingNotification?.status) || 'UNREAD';

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

        setNotifications(nextNotifications);
      } catch (error) {
        console.error('Unable to load notifications:', error);
        setNotifications([]);
      } finally {
        setLoading(false);
      }
    };

    loadNotifications();
  }, [citizenId]);

  const markNotificationAsRead = async (notification) => {
    if (normalizeReadStatus(notification.status) === 'READ') {
      return;
    }

    try {
      await updateDoc(doc(db, 'notifications', notification.id), {
        status: 'READ',
        readAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNotifications((previousNotifications) =>
        previousNotifications.map((item) => (
          item.id === notification.id
            ? { ...item, status: 'READ' }
            : item
        ))
      );
    } catch (error) {
      console.error('Unable to mark notification as read:', error);
    }
  };

  return (
    <ScrollView style={styles.scrollView} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Notifications</Text>
      <Text style={styles.bodyText}>
        Complaint status updates will appear here as soon as they are updated by the police station.
      </Text>

      {loading ? <Text style={styles.bodyText}>Loading notifications...</Text> : null}

      {!loading && notifications.length === 0 ? (
        <Text style={styles.bodyText}>No notifications yet.</Text>
      ) : null}

      {!loading && notifications.some((notification) => normalizeReadStatus(notification.status) === 'UNREAD') ? (
        <View style={styles.unreadSummaryBadge}>
          <Text style={styles.unreadSummaryText}>
            {notifications.filter((notification) => normalizeReadStatus(notification.status) === 'UNREAD').length} unread
          </Text>
        </View>
      ) : null}

      {!loading
        ? notifications.map((notification) => (
            <Pressable
              key={notification.id}
              style={({ pressed }) => [
                styles.card,
                normalizeReadStatus(notification.status) === 'UNREAD' && styles.cardUnread,
                pressed && styles.cardPressed,
              ]}
              onPress={() => markNotificationAsRead(notification)}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Track ID: {notification.trackID}</Text>
                {normalizeReadStatus(notification.status) === 'UNREAD' ? (
                  <Text style={styles.unreadBadge}>UNREAD</Text>
                ) : null}
              </View>
              <Text style={styles.cardStatus}>{notification.complaintStatus}</Text>
              <Text style={styles.cardMessage}>{notification.message}</Text>
            </Pressable>
          ))
        : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  page: {
    padding: 20,
    paddingBottom: 32,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  bodyText: {
    fontSize: 15,
    color: '#334155',
    marginBottom: 8,
  },
  unreadSummaryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#dbeafe',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 8,
  },
  unreadSummaryText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1d4ed8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardUnread: {
    borderColor: '#60a5fa',
    backgroundColor: '#eff6ff',
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  unreadBadge: {
    backgroundColor: '#2563eb',
    color: '#ffffff',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
  },
  cardStatus: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E3A8A',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardMessage: {
    fontSize: 15,
    color: '#1e293b',
    lineHeight: 22,
  },
});
