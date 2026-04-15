import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebaseConfig';
import { generateAnonOwnerHash } from './anonTracking';

const QUICK_ACTIONS = [
  { key: 'new-complaint', label: 'New Complaint', icon: 'document-text-outline' },
];

const INITIAL_SUMMARY_COUNTS = {
  total: 0,
  pending: 0,
  inReview: 0,
  resolved: 0,
};

const ADVERTISEMENTS = [
  require('./assets/advertisement1.png'),
  require('./assets/advertisement2.png'),
];

export default function Home({ citizen, onNewComplaintPress }) {
  const [summaryCounts, setSummaryCounts] = useState(INITIAL_SUMMARY_COUNTS);
  const [activeAdIndex, setActiveAdIndex] = useState(0);
  const adScrollRef = useRef(null);
  const adSlideWidth = useMemo(() => Dimensions.get('window').width - 40, []);
  const now = useMemo(() => new Date(), []);
  const citizenId = useMemo(
    () => citizen?.citizenUid || citizen?.citizenID || '',
    [citizen]
  );

  useEffect(() => {
    if (ADVERTISEMENTS.length < 2) {
      return undefined;
    }

    const intervalId = setInterval(() => {
      setActiveAdIndex((currentIndex) => {
        const nextIndex = (currentIndex + 1) % ADVERTISEMENTS.length;
        adScrollRef.current?.scrollTo({
          x: nextIndex * adSlideWidth,
          animated: true,
        });
        return nextIndex;
      });
    }, 5000);

    return () => clearInterval(intervalId);
  }, [adSlideWidth]);

  useEffect(() => {
    const loadComplaintSummary = async () => {
      if (!citizenId) {
        setSummaryCounts(INITIAL_SUMMARY_COUNTS);
        return;
      }

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

        const [nonAnonymousSnapshot, anonymousSnapshot] = await Promise.all([
          getDocs(nonAnonymousComplaintsQuery),
          getDocs(anonymousComplaintsQuery),
        ]);

        const complaintMap = new Map();
        nonAnonymousSnapshot.docs.forEach((documentSnapshot) => {
          complaintMap.set(documentSnapshot.id, documentSnapshot);
        });
        anonymousSnapshot.docs.forEach((documentSnapshot) => {
          complaintMap.set(documentSnapshot.id, documentSnapshot);
        });

        const complaintDocuments = Array.from(complaintMap.values());

        const nextCounts = {
          total: complaintDocuments.length,
          pending: 0,
          inReview: 0,
          resolved: 0,
        };

        complaintDocuments.forEach((documentSnapshot) => {
          const data = documentSnapshot.data();
          const rawStatus = (data?.status || data?.complaintStatus || 'pending')
            .toString()
            .trim()
            .toLowerCase();

          if (rawStatus.includes('resolved')) {
            nextCounts.resolved += 1;
            return;
          }

          if (rawStatus.includes('ongoing')) {
            nextCounts.inReview += 1;
            return;
          }

          if (rawStatus.includes('pending')) {
            nextCounts.pending += 1;
            return;
          }

          nextCounts.pending += 1;
        });

        setSummaryCounts(nextCounts);
      } catch (error) {
        console.error('Unable to load complaint status summary:', error);
        setSummaryCounts(INITIAL_SUMMARY_COUNTS);
      }
    };

    loadComplaintSummary();
  }, [citizenId]);

  const statusSummary = useMemo(
    () => [
      { key: 'total', label: 'Total Complaints', value: summaryCounts.total },
      { key: 'pending', label: 'Pending', value: summaryCounts.pending },
      { key: 'in-review', label: 'In Review', value: summaryCounts.inReview },
      { key: 'resolved', label: 'Resolved', value: summaryCounts.resolved },
    ],
    [summaryCounts]
  );

  const formattedDateTime = useMemo(
    () =>
      now.toLocaleString('en-LK', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [now]
  );

  const lastLoginNote = useMemo(() => {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return yesterday.toLocaleString('en-LK', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }, [now]);

  const handleQuickAction = (actionKey) => {
    if (actionKey === 'new-complaint' && onNewComplaintPress) {
      onNewComplaintPress();
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.section}>
        <Text style={styles.metaText}>Today: {formattedDateTime}</Text>
        <Text style={styles.metaText}>Last login: {lastLoginNote}</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.quickActionsGrid}>
          {QUICK_ACTIONS.map((action) => (
            <TouchableOpacity
              key={action.key}
              style={styles.quickActionCard}
              onPress={() => handleQuickAction(action.key)}
              activeOpacity={0.8}
            >
              <View style={styles.quickActionContent}>
                {action.key === 'new-complaint' ? (
                  <Image source={require('./assets/new-complaint.png')} style={styles.quickActionImage} resizeMode="contain" />
                ) : (
                  <Ionicons name={action.icon} size={34} color="#1E3A8A" />
                )}
                <Text style={styles.quickActionText}>{action.label}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Complaint Status Summary</Text>
        <View style={styles.statusGrid}>
          {statusSummary.map((status) => (
            <View key={status.key} style={styles.statusCard}>
              <Text style={styles.statusValue}>{status.value}</Text>
              <Text style={styles.statusLabel}>{status.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Advertisements</Text>
        <View style={styles.adCard}>
          <ScrollView
            ref={adScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(event) => {
              const nextIndex = Math.round(event.nativeEvent.contentOffset.x / adSlideWidth);
              setActiveAdIndex(nextIndex);
            }}
          >
            {ADVERTISEMENTS.map((imageSource, index) => (
              <View key={`ad-${index}`} style={[styles.adSlide, { width: adSlideWidth }]}> 
                <Image source={imageSource} style={styles.adImage} resizeMode="cover" />
              </View>
            ))}
          </ScrollView>
          <View style={styles.adDotsRow}>
            {ADVERTISEMENTS.map((_, index) => (
              <View
                key={`dot-${index}`}
                style={[
                  styles.adDot,
                  index === activeAdIndex ? styles.adDotActive : null,
                ]}
              />
            ))}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 20,
    paddingBottom: 28,
  },
  section: {
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 10,
  },
  metaText: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 4,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
    columnGap: 12,
    rowGap: 12,
  },
  quickActionCard: {
    width: '48%',
    paddingHorizontal: 6,
    marginBottom: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  quickActionContent: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  quickActionImage: {
    width: 50,
    height: 50,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 12,
    rowGap: 12,
    marginHorizontal: -6,
  },
  statusCard: {
    width: '48%',
    paddingHorizontal: 6,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    minHeight: 90,
  },
  statusValue: {
    fontSize: 26,
    color: '#1E3A8A',
    fontWeight: '800',
    marginBottom: 4,
  },
  statusLabel: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  adCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    overflow: 'hidden',
  },
  adSlide: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  adImage: {
    width: '100%',
    height: 180,
  },
  adDotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  adDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#cbd5e1',
  },
  adDotActive: {
    width: 20,
    backgroundColor: '#1E3A8A',
  },
});
