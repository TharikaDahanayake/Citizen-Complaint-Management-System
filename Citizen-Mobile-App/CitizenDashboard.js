import { useMemo, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Home from './Home';
import Activities from './Activities';
import Notifications from './Notifications';
import Profile from './Profile';
import ComplaintSubmission from './ComplaintSubmission';
import AnonymousComplaintSubmission from './AnonymousComplaintSubmission';
import NonAnonymousComplaintSubmission from './NonAnonymousComplaintSubmission';

const TABS = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'activities', label: 'Activities', icon: 'pulse' },
  { key: 'notifications', label: 'Notifications', icon: 'notifications' },
  { key: 'profile', label: 'Profile', icon: 'person' },
];

export default function CitizenDashboard({ citizen, onLogout }) {
  const [activeTab, setActiveTab] = useState('home');
  const [homeScreen, setHomeScreen] = useState('home');
  const showHomeWelcomeTab = activeTab === 'home' && homeScreen === 'home';

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
      return <Activities />;
    }

    if (activeTab === 'notifications') {
      return <Notifications />;
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
              <Ionicons
                name={selected ? tab.icon : `${tab.icon}-outline`}
                size={22}
                color={selected ? '#737000' : '#94a3b8'}
              />
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
    backgroundColor: '#737000',
    paddingHorizontal: 20,
    paddingVertical: 14,
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
  tabLabel: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  tabLabelActive: {
    color: '#737000',
  },
});
