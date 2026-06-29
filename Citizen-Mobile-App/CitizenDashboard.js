import { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import Home from './Home';
import Activities from './Activities';
import Notifications from './Notifications';
import Profile from './Profile';
import ComplaintSubmission from './ComplaintSubmission';
import AnonymousComplaintSubmission from './AnonymousComplaintSubmission';
import NonAnonymousComplaintSubmission from './NonAnonymousComplaintSubmission';
import { generateAnonOwnerHash } from './anonTracking';
import { db } from './firebaseConfig';

const TABS = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'activities', label: 'Activities', icon: 'pulse' },
  { key: 'notifications', label: 'Notifications', icon: 'notifications' },
  { key: 'profile', label: 'Profile', icon: 'person' },
];

export default function CitizenDashboard({ citizen, onLogout }) {
  const [activeTab, setActiveTab] = useState('home');
  const [homeScreen, setHomeScreen] = useState('home');
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const showHomeWelcomeTab = activeTab === 'home' && homeScreen === 'home';

  const citizenId = useMemo(
    () => citizen?.citizenUid || citizen?.citizenID || '',
    [citizen]
  );

  useEffect(() => {
    let isCancelled = false;
    let unsubscribeCitizenNotifications = null;
    let unsubscribeAnonymousNotifications = null;

    const normalizeReadStatus = (value) => (value || '').toString().trim().toUpperCase();

    const updateUnreadCount = (citizenSnapshot, anonymousSnapshot) => {
      const notificationMap = new Map();

      citizenSnapshot.docs.forEach((documentSnapshot) => {
        notificationMap.set(documentSnapshot.id, documentSnapshot);
      });

      anonymousSnapshot.docs.forEach((documentSnapshot) => {
        notificationMap.set(documentSnapshot.id, documentSnapshot);
      });

      const unreadCount = Array.from(notificationMap.values()).filter((documentSnapshot) => {
        const data = documentSnapshot.data() || {};
        return normalizeReadStatus(data.status) === 'UNREAD';
      }).length;

      setUnreadNotificationCount(unreadCount);
    };

    const subscribeToNotifications = async () => {
      if (!citizenId) {
        setUnreadNotificationCount(0);
        return;
      }

      try {
        const anonOwnerHash = await generateAnonOwnerHash(citizenId);

        if (isCancelled) {
          return;
        }

        const citizenNotificationsQuery = query(
          collection(db, 'notifications'),
          where('citizenID', '==', citizenId)
        );
        const anonymousNotificationsQuery = query(
          collection(db, 'notifications'),
          where('anonOwnerHash', '==', anonOwnerHash)
        );

        let citizenSnapshot = null;
        let anonymousSnapshot = null;

        const maybeUpdateUnreadCount = () => {
          if (citizenSnapshot && anonymousSnapshot) {
            updateUnreadCount(citizenSnapshot, anonymousSnapshot);
          }
        };

        unsubscribeCitizenNotifications = onSnapshot(
          citizenNotificationsQuery,
          (snapshot) => {
            citizenSnapshot = snapshot;
            maybeUpdateUnreadCount();
          },
          (error) => {
            console.error('Unable to subscribe to citizen notifications:', error);
          }
        );

        unsubscribeAnonymousNotifications = onSnapshot(
          anonymousNotificationsQuery,
          (snapshot) => {
            anonymousSnapshot = snapshot;
            maybeUpdateUnreadCount();
          },
          (error) => {
            console.error('Unable to subscribe to anonymous notifications:', error);
          }
        );
      } catch (error) {
        console.error('Unable to load unread notification count:', error);
        setUnreadNotificationCount(0);
      }
    };

    subscribeToNotifications();

    return () => {
      isCancelled = true;
      if (unsubscribeCitizenNotifications) {
        unsubscribeCitizenNotifications();
      }
      if (unsubscribeAnonymousNotifications) {
        unsubscribeAnonymousNotifications();
      }
    };
  }, [citizenId]);

  const currentContent = useMemo(() => {
    if (activeTab === 'home') {
      if (homeScreen === 'complaint-submission') {
        return (
          <ComplaintSubmission
            onAnonymousPress={() => setHomeScreen('anonymous-complaint')}
            onNonAnonymousPress={() => setHomeScreen('non-anonymous-complaint')}
            onBackToHome={() => setHomeScreen('home')}
          />
        );
      }

      if (homeScreen === 'anonymous-complaint') {
        return (
          <AnonymousComplaintSubmission
            citizen={citizen}
            onBack={() => setHomeScreen('complaint-submission')}
          />
        );
      }

      if (homeScreen === 'non-anonymous-complaint') {
        return (
          <NonAnonymousComplaintSubmission
            citizen={citizen}
            onBack={() => setHomeScreen('complaint-submission')}
          />
        );
      }

      return <Home citizen={citizen} onNewComplaintPress={() => setHomeScreen('complaint-submission')} />;
    }

    if (activeTab === 'activities') {
      return <Activities citizen={citizen} />;
    }

    if (activeTab === 'notifications') {
      return <Notifications citizen={citizen} />;
    }

    if (activeTab === 'profile') {
      return <Profile citizen={citizen} onLogout={onLogout} />;
    }

    return <Home citizen={citizen} onNewComplaintPress={() => setHomeScreen('complaint-submission')} />;
  }, [activeTab, citizen, homeScreen, onLogout]);

  return (
    <SafeAreaView style={styles.safeArea}>
      {showHomeWelcomeTab ? (
        <View style={styles.topTab}>
          <Text style={styles.topTabText}>Welcome, {citizen?.citizenName || 'Citizen'}</Text>
        </View>
      ) : null}

      <View style={styles.content}>{currentContent}</View>

      <View style={styles.bottomTabBar}>
        {TABS.map((tab) => {
          const selected = activeTab === tab.key;

          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.tabItem}
              onPress={() => {
                setActiveTab(tab.key);
                if (tab.key === 'home') {
                  setHomeScreen('home');
                }
              }}
              activeOpacity={0.8}
            >
              <View style={styles.iconWrap}>
                <Ionicons
                  name={selected ? tab.icon : `${tab.icon}-outline`}
                  size={22}
                  color={selected ? '#1E3A8A' : '#94a3b8'}
                />
                {tab.key === 'notifications' && unreadNotificationCount > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  topTab: {
    backgroundColor: '#1E3A8A',
    paddingHorizontal: 20,
    paddingVertical: 25,
  },
  topTabText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  bottomTabBar: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#cbd5e1',
    paddingTop: 8,
    paddingBottom: 10,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  iconWrap: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 12,
  },
  tabLabel: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  tabLabelActive: {
    color: '#1E3A8A',
  },
});
