import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { generateAnonOwnerHash } from './anonTracking';
import { db } from './firebaseConfig';
import { normalizeStatus, statusMatchesTab } from './statusUtils';

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
  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState('');

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

          const createdAtMs = toMillis(data.createdAt);
          const updatedAtMs = toMillis(data.updatedAt);

          return {
            id: documentSnapshot.id,
            trackID: formatTrackID(data.trackID),
            title: data.title || 'Untitled Complaint',
            description: data.description || 'No description provided.',
            complaintCategory: data.complaintCategory || data.category || 'Unknown',
            incidentLocation: data.incidentLocation || '',
            locationUrl: buildLocationUrl(data),
            evidenceUrls: Array.isArray(data.evidenceUrls)
              ? data.evidenceUrls.filter((url) => typeof url === 'string' && url.trim())
              : [],
            status: data.status || data.complaintStatus || 'Pending',
            comment: data.comment || '',
            feedback: data.feedback || '',
            stationID: complaintStationId || 'N/A',
            stationName: data.stationName || 'N/A',
            department: data.department || 'N/A',
            officerName: matchedOfficer?.officerName || 'Unassigned',
            officerContact: matchedOfficer?.officerContact || 'N/A',
            officerID: complaintOfficerId || 'N/A',
            createdAtMs,
            updatedAtMs,
          };
        });

        nextComplaints.sort((a, b) => {
          const bTime = b.createdAtMs || b.updatedAtMs || 0;
          const aTime = a.createdAtMs || a.updatedAtMs || 0;
          return bTime - aTime;
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

  const openExternalLink = async (url) => {
    if (!url) {
      return;
    }

    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    }
  };

  const openComplaintDetails = (complaint) => {
    setSelectedComplaint(complaint);
    setFeedbackText(complaint.feedback || '');
    setFeedbackNotice('');
  };

  const closeComplaintDetails = () => {
    setSelectedComplaint(null);
    setFeedbackText('');
    setFeedbackNotice('');
  };

  const submitFeedback = async () => {
    if (!selectedComplaint || normalizeStatus(selectedComplaint.status) !== 'resolved') {
      return;
    }

    const trimmedFeedback = feedbackText.trim();
    if (!trimmedFeedback) {
      return;
    }

    setSavingFeedback(true);

    try {
      await updateDoc(doc(db, 'complaints', selectedComplaint.id), {
        feedback: trimmedFeedback,
        feedbackAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSelectedComplaint((previousComplaint) => ({
        ...previousComplaint,
        feedback: trimmedFeedback,
      }));

      setFeedbackText(trimmedFeedback);
      setFeedbackNotice('Feedback submitted successfully.');

      setComplaints((previousComplaints) => (
        previousComplaints.map((complaint) => (
          complaint.id === selectedComplaint.id
            ? { ...complaint, feedback: trimmedFeedback }
            : complaint
        ))
      ));
    } catch (error) {
      console.error('Unable to save feedback:', error);
    } finally {
      setSavingFeedback(false);
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

      {selectedComplaint ? (
        <View style={styles.detailPageCard}>
          <Text style={styles.detailPageTitle}>{selectedComplaint.title}</Text>
          <Text style={styles.detailPageSubtitle}>{activeTab} Complaint Details</Text>

          <View style={styles.trackIdBadge}>
            <Text style={styles.trackIdBadgeText}>Track ID: {selectedComplaint.trackID}</Text>
          </View>

          <View style={styles.badgeRow}>
            <View style={styles.primaryBadge}>
              <Text style={styles.primaryBadgeText}>Status: {selectedComplaint.status}</Text>
            </View>
            <View style={styles.secondaryBadge}>
              <Text style={styles.secondaryBadgeText}>{selectedComplaint.complaintCategory}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitleText}>Description</Text>
          <View style={styles.descriptionBox}>
            <Text style={styles.descriptionText}>{selectedComplaint.description}</Text>
          </View>

          <Text style={styles.sectionTitleText}>Location</Text>
          {selectedComplaint.locationUrl ? (
            <Pressable style={styles.actionLink} onPress={() => openExternalLink(selectedComplaint.locationUrl)}>
              <Text style={styles.actionLinkText}>Show location</Text>
            </Pressable>
          ) : (
            <Text style={styles.emptyText}>N/A</Text>
          )}

          <Text style={styles.sectionTitleText}>Evidence</Text>
          {selectedComplaint.evidenceUrls.length > 0 ? (
            selectedComplaint.evidenceUrls.map((url, index) => (
              <Pressable
                key={`${selectedComplaint.id}-evidence-${index}`}
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
          <DetailRow label="Station Name" value={selectedComplaint.stationName} />
          <DetailRow label="Department" value={selectedComplaint.department} />
          <DetailRow label="Officer Name" value={selectedComplaint.officerName} />
          <DetailRow label="Officer Contact" value={selectedComplaint.officerContact} />
          {activeTab === 'Resolved' ? (
            <DetailRow label="Solution" value={selectedComplaint.comment || 'N/A'} />
          ) : null}

          {normalizeStatus(selectedComplaint.status) === 'resolved' ? (
            <View style={styles.feedbackSection}>
              <Text style={styles.feedbackLabel}>Feedback</Text>

              {selectedComplaint.feedback ? (
                <View style={styles.feedbackSavedBox}>
                  <Text style={styles.feedbackSavedText}>{selectedComplaint.feedback}</Text>
                </View>
              ) : (
                <>
                  <TextInput
                    style={styles.feedbackInput}
                    value={feedbackText}
                    onChangeText={setFeedbackText}
                    placeholder="Enter your feedback here"
                    placeholderTextColor="#94a3b8"
                    multiline
                    textAlignVertical="top"
                  />

                  <Pressable
                    style={[styles.feedbackButton, savingFeedback && styles.feedbackButtonDisabled]}
                    onPress={submitFeedback}
                    disabled={savingFeedback}
                  >
                    <Text style={styles.feedbackButtonText}>
                      {savingFeedback ? 'Saving...' : 'Give Feedback'}
                    </Text>
                  </Pressable>
                </>
              )}

              {feedbackNotice ? <Text style={styles.feedbackSuccessText}>{feedbackNotice}</Text> : null}
            </View>
          ) : null}

          <Pressable style={styles.backButton} onPress={closeComplaintDetails}>
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
        </View>
      ) : null}

      {!selectedComplaint ? (
        <>
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
            <View style={styles.subPageHeader}>
              <View>
                <Text style={styles.subPageTitle}>{activeTab} Complaints</Text>
                <Text style={styles.subPageSubtitle}>Tap Details to open a full complaint page.</Text>
              </View>
            </View>

            {loading ? <Text style={styles.bodyText}>Loading complaints...</Text> : null}

            {!loading && filteredComplaints.length === 0 ? (
              <Text style={styles.bodyText}>{tabMessages[activeTab]}</Text>
            ) : null}

            {!loading
              ? filteredComplaints.map((complaint) => (
                  <View key={complaint.id} style={styles.complaintBox}>
                    <View style={styles.complaintHeader}>
                      <View style={styles.complaintHeaderText}>
                        <Text style={styles.complaintTitle}>{complaint.title}</Text>
                        <View style={styles.trackIdBadge}>
                          <Text style={styles.trackIdBadgeText}>Track ID: {complaint.trackID}</Text>
                        </View>
                      </View>
                      <View style={styles.statusPill}>
                        <Text style={styles.statusPillText}>{complaint.status}</Text>
                      </View>
                    </View>

                    <Text style={styles.complaintPreview} numberOfLines={2}>
                      {complaint.description}
                    </Text>

                    <View style={styles.complaintFooter}>
                      <View style={styles.categoryPill}>
                        <Text style={styles.categoryPillText}>{complaint.complaintCategory}</Text>
                      </View>

                      <Pressable style={styles.detailsButton} onPress={() => openComplaintDetails(complaint)}>
                        <Text style={styles.detailsButtonText}>Details</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              : null}
          </View>
        </>
      ) : null}
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
    backgroundColor: '#1E3A8A',
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
  subPageHeader: {
    marginBottom: 8,
  },
  subPageTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  subPageSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
  },
  bodyText: {
    fontSize: 15,
    color: '#334155',
    marginBottom: 8,
  },
  detailPageCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#dbeafe',
    marginBottom: 14,
  },
  backButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1E3A8A',
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginBottom: 12,
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  detailPageTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  detailPageSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 12,
  },
  feedbackSection: {
    marginTop: 10,
  },
  feedbackLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  feedbackInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
    marginBottom: 10,
  },
  feedbackButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1E3A8A',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  feedbackButtonDisabled: {
    opacity: 0.7,
  },
  feedbackButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  feedbackSavedBox: {
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  feedbackSavedText: {
    fontSize: 14,
    color: '#166534',
    lineHeight: 20,
  },
  feedbackSuccessText: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#15803d',
  },
  complaintBox: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 16,
    padding: 14,
    marginTop: 12,
    backgroundColor: '#ffffff',
  },
  complaintHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 6,
  },
  complaintHeaderText: {
    flex: 1,
  },
  complaintTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  complaintMeta: {
    fontSize: 12,
    color: '#64748b',
  },
  trackIdBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 6,
  },
  trackIdBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1d4ed8',
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
  complaintPreview: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
    marginBottom: 6,
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
  complaintFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8,
  },
  statusPill: {
    backgroundColor: '#e2e8f0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  categoryPill: {
    backgroundColor: '#fef9c3',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flex: 1,
  },
  categoryPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#854d0e',
  },
  detailsButton: {
    backgroundColor: '#1E3A8A',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  detailsButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
