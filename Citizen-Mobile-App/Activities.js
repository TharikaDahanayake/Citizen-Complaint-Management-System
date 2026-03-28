import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { generateAnonOwnerHash } from './anonTracking';
import { db } from './firebaseConfig';

const normalizeStatus = (value) => (value || '').toString().trim().toLowerCase();

const statusMatchesTab = (statusValue, tabLabel) => {
  const status = normalizeStatus(statusValue);

  if (tabLabel === 'Pending') {
    return status.includes('pending') || !status;
  }

  if (tabLabel === 'Ongoing') {
    return status.includes('ongoing') || status.includes('progress') || status.includes('in progress');
  }

  if (tabLabel === 'Escalated') {
    return status.includes('escalat');
  }

  if (tabLabel === 'Resolved') {
    return status.includes('resolved');
  }

  return false;
};

const buildLocationUrl = (complaint) => {
  const latitude = complaint?.latitude;
  const longitude = complaint?.longitude;
  const locationText = (complaint?.incidentLocation || '').toString().trim();

  if (typeof latitude === 'number' && typeof longitude === 'number') {
    return `https://maps.google.com/?q=${latitude},${longitude}`;
  }

  if (locationText.startsWith('http://') || locationText.startsWith('https://')) {
    return locationText;
  }

  if (locationText) {
    return `https://maps.google.com/?q=${encodeURIComponent(locationText)}`;
  }

  return '';
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
        officerName: data.officerName || data.name || data.fullName || 'Unassigned',
        officerContact: data.officerContact || data.contact || data.phone || 'N/A',
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

    // If complaint has a station, do not assign officer from a different station.
    return null;
  }

  return matches[0];
};

const DetailRow = ({ label, value }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value || 'N/A'}</Text>
  </View>
);

export default function Activities({ citizen }) {
  const tabs = useMemo(() => ['Pending', 'Ongoing', 'Escalated', 'Resolved'], []);
  const [activeTab, setActiveTab] = useState('Pending');
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedComplaints, setExpandedComplaints] = useState({});

  const citizenId = useMemo(
    () => citizen?.citizenUid || citizen?.citizenID || '',
    [citizen]
  );

  useEffect(() => {
    const loadComplaints = async () => {
      if (!citizenId) {
        setComplaints([]);
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

        const complaintMap = new Map();
        nonAnonymousSnapshot.docs.forEach((documentSnapshot) => {
          complaintMap.set(documentSnapshot.id, documentSnapshot);
        });
        anonymousSnapshot.docs.forEach((documentSnapshot) => {
          complaintMap.set(documentSnapshot.id, documentSnapshot);
        });

        const officerMap = buildOfficerMap(officersSnapshot.docs);

        const nextComplaints = Array.from(complaintMap.values()).map((documentSnapshot) => {
          const data = documentSnapshot.data() || {};
          const complaintOfficerId = (data.officerID || '').toString().trim();
          const complaintStationId = (data.stationID || data.stationId || '').toString().trim();
          const matchedOfficer = findOfficerByIdAndStation(
            officerMap,
            complaintOfficerId,
            complaintStationId
          );

          return {
            id: documentSnapshot.id,
            title: data.title || 'Untitled Complaint',
            description: data.description || 'No description provided.',
            complaintCategory: data.complaintCategory || data.category || 'Unknown',
            incidentLocation: data.incidentLocation || '',
            locationUrl: buildLocationUrl(data),
            evidenceUrls: Array.isArray(data.evidenceUrls)
              ? data.evidenceUrls.filter((url) => typeof url === 'string' && url.trim())
              : [],
            status: data.status || data.complaintStatus || 'Pending',
            stationID: complaintStationId || 'N/A',
            stationName: data.stationName || 'N/A',
            department: data.department || 'N/A',
            officerName: matchedOfficer?.officerName || 'Unassigned',
            officerContact: matchedOfficer?.officerContact || 'N/A',
            officerID: complaintOfficerId || 'N/A',
          };
        });

        setComplaints(nextComplaints);
      } catch (error) {
        console.error('Unable to load complaints for activities:', error);
        setComplaints([]);
      } finally {
        setLoading(false);
      }
    };

    loadComplaints();
  }, [citizenId]);

  const filteredComplaints = useMemo(
    () => complaints.filter((complaint) => statusMatchesTab(complaint.status, activeTab)),
    [activeTab, complaints]
  );

  const toggleExpanded = (complaintId) => {
    setExpandedComplaints((previous) => ({
      ...previous,
      [complaintId]: !previous[complaintId],
    }));
  };

  const openExternalLink = async (url) => {
    if (!url) {
      return;
    }

    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    }
  };

  const tabMessages = {
    Pending: 'Pending complaints will appear here.',
    Ongoing: 'Ongoing complaints that are in progress will appear here.',
    Escalated: 'Escalated complaints will appear here.',
    Resolved: 'Resolved complaints will appear here.',
  };

  return (
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Activities</Text>

      <View style={styles.tabBar}>
        {tabs.map((tab) => {
          const isActive = tab === activeTab;
          return (
            <Pressable
              key={tab}
              style={[styles.tabButton, isActive && styles.activeTabButton]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, isActive && styles.activeTabText]}>{tab}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.subPageCard}>
        <Text style={styles.subPageTitle}>{activeTab} Complaints</Text>

        {loading ? <Text style={styles.bodyText}>Loading complaints...</Text> : null}

        {!loading && filteredComplaints.length === 0 ? (
          <Text style={styles.bodyText}>{tabMessages[activeTab]}</Text>
        ) : null}

        {!loading
          ? filteredComplaints.map((complaint) => {
              const isExpanded = !!expandedComplaints[complaint.id];

              return (
                <View key={complaint.id} style={styles.complaintBox}>
                  <Text style={styles.complaintTitle}>{complaint.title}</Text>
                  <View style={styles.badgeRow}>
                    <View style={styles.primaryBadge}>
                      <Text style={styles.primaryBadgeText}>Status: {complaint.status}</Text>
                    </View>
                    <View style={styles.secondaryBadge}>
                      <Text style={styles.secondaryBadgeText}>{complaint.complaintCategory}</Text>
                    </View>
                  </View>

                  {!isExpanded ? null : (
                    <View style={styles.detailsContainer}>
                      <Text style={styles.sectionTitleText}>Description</Text>
                      <View style={styles.descriptionBox}>
                        <Text style={styles.descriptionText}>{complaint.description}</Text>
                      </View>

                      <Text style={styles.sectionTitleText}>Location</Text>
                      {complaint.locationUrl ? (
                        <Pressable style={styles.actionLink} onPress={() => openExternalLink(complaint.locationUrl)}>
                          <Text style={styles.actionLinkText}>Show location</Text>
                        </Pressable>
                      ) : (
                        <Text style={styles.emptyText}>N/A</Text>
                      )}

                      <Text style={styles.sectionTitleText}>Evidence</Text>
                      {complaint.evidenceUrls.length > 0 ? (
                        complaint.evidenceUrls.map((url, index) => (
                          <Pressable
                            key={`${complaint.id}-evidence-${index}`}
                            style={styles.actionLink}
                            onPress={() => openExternalLink(url)}
                          >
                            <Text style={styles.actionLinkText}>Open Evidence {index + 1}</Text>
                          </Pressable>
                        ))
                      ) : (
                        <Text style={styles.emptyText}>No evidence links</Text>
                      )}

                      <Text style={styles.sectionTitleText}>Assignment</Text>
                      <DetailRow label="Status" value={complaint.status} />
                      <DetailRow label="Station Name" value={complaint.stationName} />
                      <DetailRow label="Department" value={complaint.department} />
                      {activeTab === 'Ongoing' ? (
                        <DetailRow label="Officer Name" value={complaint.officerName} />
                      ) : null}
                      {activeTab === 'Ongoing' ? (
                        <DetailRow label="Officer Contact" value={complaint.officerContact} />
                      ) : null}
                    </View>
                  )}

                  <Pressable style={styles.detailsButton} onPress={() => toggleExpanded(complaint.id)}>
                    <Text style={styles.detailsButtonText}>{isExpanded ? 'Hide Details' : 'Details'}</Text>
                  </Pressable>
                </View>
              );
            })
          : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 20,
    paddingBottom: 28,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    padding: 4,
    marginBottom: 14,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingVertical: 9,
  },
  activeTabButton: {
    backgroundColor: '#737000',
  },
  tabText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
  activeTabText: {
    color: '#f8fafc',
  },
  subPageCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 14,
  },
  subPageTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
  },
  bodyText: {
    fontSize: 15,
    color: '#334155',
    marginBottom: 8,
  },
  complaintBox: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    backgroundColor: '#ffffff',
  },
  complaintTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  primaryBadge: {
    backgroundColor: '#e2e8f0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  primaryBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  secondaryBadge: {
    backgroundColor: '#fef9c3',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  secondaryBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#854d0e',
  },
  detailsContainer: {
    marginBottom: 10,
  },
  sectionTitleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
    marginTop: 6,
  },
  descriptionBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 10,
    marginBottom: 4,
  },
  descriptionText: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
  },
  actionLink: {
    alignSelf: 'flex-start',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#93c5fd', 
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  actionLinkText: {
    color: '#1d4ed8',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 8,
  },
  detailRow: {
    marginBottom: 6,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  detailValue: {
    fontSize: 14,
    color: '#0f172a',
    marginTop: 2,
  },
  detailsButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#737000',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  detailsButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
