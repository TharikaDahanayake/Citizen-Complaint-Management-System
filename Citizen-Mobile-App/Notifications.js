import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { syncNotificationsForCitizen } from './notificationSyncService';
import { db } from './firebaseConfig';

const normalizeStatus = (value) => (value || '').toString().trim().toLowerCase();
const normalizeReadStatus = (value) => (value || '').toString().trim().toUpperCase();

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
        const nextNotifications = await syncNotificationsForCitizen(citizenId);
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
