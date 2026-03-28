import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import MapView, { Marker } from 'react-native-maps';
import DateTimePicker from '@react-native-community/datetimepicker';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { addDoc, collection, doc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebaseConfig';
import { categorizeComplaint } from './complaintCategorizationService';
import { stationsService } from './stationsService';
import { stationDepartmentService } from './stationDepartmentService';
import { locationRoutingService } from './locationRoutingService';

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
const CLOUDINARY_CLOUD_NAME = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

const formatDateForInput = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function NonAnonymousComplaintSubmission({ citizen, onBack }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [incidentDate, setIncidentDate] = useState(() => formatDateForInput(new Date()));
  const [incidentDateValue, setIncidentDateValue] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [incidentLocation, setIncidentLocation] = useState('');
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [evidenceAssets, setEvidenceAssets] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [mapRegion, setMapRegion] = useState(null);
  const [selectedCoordinate, setSelectedCoordinate] = useState(null);

  const handleDateChange = (event, selectedDate) => {
    if (Platform.OS === 'android') {
      if (event.type === 'dismissed' || !selectedDate) {
        return;
      }

      setIncidentDateValue(selectedDate);
      setIncidentDate(formatDateForInput(selectedDate));
      return;
    }

    if (event?.type === 'dismissed') {
      setShowDatePicker(false);
      return;
    }

    if (!selectedDate) {
      setShowDatePicker(false);
      return;
    }

    setIncidentDateValue(selectedDate);
    setIncidentDate(formatDateForInput(selectedDate));
    setShowDatePicker(false);
  };

  const openDatePicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: incidentDateValue,
        mode: 'date',
        display: 'calendar',
        maximumDate: new Date(),
        onChange: handleDateChange,
      });
      return;
    }

    setShowDatePicker(true);
  };

  const citizenId = useMemo(
    () => citizen?.citizenUid || citizen?.citizenID || auth.currentUser?.uid || '',
    [citizen]
  );

  const validateForm = () => {
    if (!title.trim()) {
      return 'Title is required.';
    }

    if (!description.trim()) {
      return 'Description is required.';
    }

    if (!incidentDate.trim()) {
      return 'Date is required.';
    }

    if (!incidentLocation.trim()) {
      return 'Incident location is required.';
    }

    if (latitude === null || longitude === null) {
      return 'Please capture GPS location to extract latitude and longitude.';
    }

    if (!citizenId) {
      return 'Citizen details are missing. Please log in again.';
    }

    return '';
  };

  const handleUseGpsLocation = async () => {
    setLoadingLocation(true);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Location permission is required to capture GPS location.');
        return;
      }

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });

      const lat = current.coords.latitude;
      const lng = current.coords.longitude;

      setLatitude(lat);
      setLongitude(lng);
      setSelectedCoordinate({ latitude: lat, longitude: lng });
      setMapRegion({
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      });

      if (GOOGLE_MAPS_API_KEY) {
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`
        );
        const data = await response.json();

        const formattedAddress = data?.results?.[0]?.formatted_address;
        if (formattedAddress) {
          setIncidentLocation(formattedAddress);
          return;
        }
      }

      setIncidentLocation(`${lat}, ${lng}`);
    } catch (error) {
      Alert.alert('Location Error', error?.message || 'Unable to get GPS location.');
    } finally {
      setLoadingLocation(false);
    }
  };

  const reverseGeocodeWithGoogle = async (lat, lng) => {
    if (!GOOGLE_MAPS_API_KEY) {
      return `${lat}, ${lng}`;
    }

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`
    );
    const data = await response.json();
    return data?.results?.[0]?.formatted_address || `${lat}, ${lng}`;
  };

  const openMapPicker = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Location permission is required to open map picker.');
        return;
      }

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const lat = current.coords.latitude;
      const lng = current.coords.longitude;

      setMapRegion({
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      });

      if (!selectedCoordinate) {
        setSelectedCoordinate({ latitude: lat, longitude: lng });
      }

      setShowMapPicker(true);
    } catch (error) {
      Alert.alert('Map Error', error?.message || 'Unable to open map picker.');
    }
  };

  const confirmMapLocation = async () => {
    if (!selectedCoordinate) {
      Alert.alert('Selection Required', 'Please tap on the map to select a location.');
      return;
    }

    setLoadingLocation(true);
    try {
      const lat = selectedCoordinate.latitude;
      const lng = selectedCoordinate.longitude;

      setLatitude(lat);
      setLongitude(lng);

      const address = await reverseGeocodeWithGoogle(lat, lng);
      setIncidentLocation(address);
      setShowMapPicker(false);
    } catch (error) {
      Alert.alert('Location Error', error?.message || 'Unable to confirm selected location.');
    } finally {
      setLoadingLocation(false);
    }
  };

  const handlePickEvidence = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permission Required', 'Media permission is required to upload evidence.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: false,
        allowsMultipleSelection: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets?.length) {
        setEvidenceAssets((prev) => [...prev, ...result.assets]);
      }
    } catch (error) {
      Alert.alert('Evidence Error', error?.message || 'Unable to pick evidence.');
    }
  };

  const uploadEvidenceFiles = async () => {
    if (!evidenceAssets.length) {
      return [];
    }

    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
      throw new Error(
        'Cloudinary is not configured. Set EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME and EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET.'
      );
    }

    const uploads = evidenceAssets.map(async (asset, index) => {
      try {
        const extension = (asset.fileName || asset.uri || '').split('.').pop() || 'jpg';
        const safeExtension = extension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const fileName = `complaint_${Date.now()}_${index}.${safeExtension}`;
        const contentType = asset.mimeType || (safeExtension === 'mp4' ? 'video/mp4' : 'image/jpeg');

        const formData = new FormData();
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
        formData.append('folder', `complaints/${citizenId}`);
        formData.append('file', {
          uri: asset.uri,
          type: contentType,
          name: fileName,
        });

        const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`, {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();
        if (!response.ok || !data?.secure_url) {
          throw new Error(data?.error?.message || 'Cloudinary upload failed.');
        }

        return data.secure_url;
      } catch (error) {
        console.error(`Error uploading file ${index}:`, error);
        throw new Error(`Failed to upload evidence file ${index + 1}: ${error.message}`);
      }
    });

    return Promise.all(uploads);
  };

  const handleSubmit = async () => {
    const validationError = validateForm();
    if (validationError) {
      Alert.alert('Validation Error', validationError);
      return;
    }

    setSubmitting(true);

    try {
      const evidenceUrls = await uploadEvidenceFiles();
      const aiCategorization = await categorizeComplaint(description.trim());

      // 🔹 Station Routing: Get nearest police station by location
      const allStations = await stationsService.getAllStations(true);
      const nearestStation = locationRoutingService.findNearestStation(
        allStations,
        latitude,
        longitude
      );
      const stationRoutingInfo = locationRoutingService.buildStationRoutingInfo(nearestStation);

      // 🔹 Department Routing: Get correct department ID from database
      let departmentRoutingInfo = {
        departmentID: aiCategorization.departmentID || null,
        department: aiCategorization.department || 'Unknown',
      };

      if (nearestStation && nearestStation.stationID) {
        try {
          const deptInfo = await stationDepartmentService.getDepartmentRoutingForComplaint(
            aiCategorization.complaintCategory,
            nearestStation.stationID
          );
          departmentRoutingInfo = {
            departmentID: deptInfo.departmentID || null,
            department: deptInfo.department || 'Unknown',
            departmentRoutingSource: deptInfo.departmentRoutingSource || 'unknown',
          };
        } catch (error) {
          console.warn('Failed to get department from database, using AI categorization:', error);
          departmentRoutingInfo = {
            departmentID: aiCategorization.departmentID || null,
            department: aiCategorization.department || 'Unknown',
            departmentRoutingSource: 'ai-categorization-fallback',
          };
        }
      }

      // Build complaint document with safe field extraction
      const complaintDoc = {
        title: title.trim(),
        description: description.trim(),
        incidentDate: incidentDate.trim(),
        incidentLocation: incidentLocation.trim(),
        latitude,
        longitude,
        evidenceUrls,
        citizenID: citizenId,
        citizenRef: doc(db, 'citizens', citizenId),
        complaintCategory: aiCategorization.complaintCategory || 'Unknown',
        aiConfidence: aiCategorization.aiConfidence || 0,
        aiSource: aiCategorization.aiSource || 'unknown',
        aiReviewRequired: aiCategorization.aiReviewRequired || false,
        aiThreshold: aiCategorization.aiThreshold || 0,
        aiModelVersion: aiCategorization.aiModelVersion || null,
        // Station routing info
        stationID: stationRoutingInfo.stationID || null,
        stationName: stationRoutingInfo.stationName || null,
        stationContact: stationRoutingInfo.stationContact || null,
        stationEmail: stationRoutingInfo.stationEmail || null,
        stationProvince: stationRoutingInfo.stationProvince || null,
        stationDistrict: stationRoutingInfo.stationDistrict || null,
        stationDivision: stationRoutingInfo.stationDivision || null,
        distanceToNearestStationKm: stationRoutingInfo.distanceToNearestStationKm || null,
        // Department info (these MUST NOT be undefined)
        departmentID: departmentRoutingInfo.departmentID || 'unknown',
        department: departmentRoutingInfo.department || 'Unknown',
        departmentRoutingSource: departmentRoutingInfo.departmentRoutingSource || 'unknown',
        status: 'Pending',
        officerID: null,
        comment: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await addDoc(collection(db, 'complaints'), complaintDoc);

      Alert.alert('Success', 'Complaint submitted successfully.');
      setTitle('');
      setDescription('');
      const now = new Date();
      setIncidentDate(formatDateForInput(now));
      setIncidentDateValue(now);
      setIncidentLocation('');
      setLatitude(null);
      setLongitude(null);
      setEvidenceAssets([]);
      onBack();
    } catch (error) {
      console.error('Submission error:', error);
      Alert.alert(
        'Submission Failed',
        error?.message || 'Unable to submit complaint. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Non-Anonymous Complaint Submission</Text>
      <Text style={styles.subtitle}>Your registered details will be included with the complaint.</Text>

      <View style={styles.profileCard}>
        <Text style={styles.label}>Citizen</Text>
        <Text style={styles.value}>{citizen?.citizenName || '-'}</Text>

        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{citizen?.citizenEmail || '-'}</Text>
      </View>

      <TextInput
        style={styles.input}
        placeholder="Title"
        value={title}
        onChangeText={setTitle}
      />
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Description"
        multiline
        value={description}
        onChangeText={setDescription}
      />
      <TouchableOpacity
        style={styles.dateFieldButton}
        onPress={openDatePicker}
        activeOpacity={0.8}
      >
        <Text style={[styles.dateFieldText, !incidentDate && styles.dateFieldPlaceholder]}>
          {incidentDate || 'Pick Date'}
        </Text>
      </TouchableOpacity>

      {showDatePicker && Platform.OS === 'ios' ? (
        <DateTimePicker
          value={incidentDateValue}
          mode="date"
          display="default"
          maximumDate={new Date()}
          onChange={handleDateChange}
        />
      ) : null}
      <TextInput
        style={[styles.input, styles.incidentLocationInput]}
        placeholder="Incident Location"
        value={incidentLocation}
        onChangeText={setIncidentLocation}
      />

      <TouchableOpacity
        style={[styles.secondaryButton, loadingLocation && styles.buttonDisabled]}
        onPress={openMapPicker}
        disabled={loadingLocation}
        activeOpacity={0.8}
      >
        <Text style={styles.secondaryButtonText}>Select Location on Map</Text>
      </TouchableOpacity>

      {showMapPicker && mapRegion ? (
        <View style={styles.mapPickerContainer}>
          <Text style={styles.mapHint}>Tap on the map to select incident location, then confirm.</Text>
          <MapView
            style={styles.map}
            initialRegion={mapRegion}
            region={mapRegion}
            onRegionChangeComplete={setMapRegion}
            onPress={(event) => setSelectedCoordinate(event.nativeEvent.coordinate)}
          >
            {selectedCoordinate ? (
              <Marker
                coordinate={selectedCoordinate}
                draggable
                onDragEnd={(event) => setSelectedCoordinate(event.nativeEvent.coordinate)}
              />
            ) : null}
          </MapView>

          <Text style={styles.mapCoordinatesText}>
            Selected Latitude: {selectedCoordinate?.latitude ?? '-'} | Selected Longitude:{' '}
            {selectedCoordinate?.longitude ?? '-'}
          </Text>

          <View style={styles.mapActionRow}>
            <TouchableOpacity style={styles.mapActionButton} onPress={() => setShowMapPicker(false)} activeOpacity={0.8}>
              <Text style={styles.mapActionText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.mapActionButton, styles.mapActionConfirm]}
              onPress={confirmMapLocation}
              activeOpacity={0.8}
            >
              <Text style={styles.mapActionConfirmText}>Confirm Location</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <TouchableOpacity style={styles.secondaryButton} onPress={handlePickEvidence} activeOpacity={0.8}>
        <Text style={styles.secondaryButtonText}>Upload Evidence (Images/Videos)</Text>
      </TouchableOpacity>

      <Text style={styles.evidenceCountText}>Selected Evidence: {evidenceAssets.length}</Text>

      <TouchableOpacity
        style={[styles.primaryButton, submitting && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={submitting}
        activeOpacity={0.8}
      >
        {submitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Submit Complaint</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.8}>
        <Text style={styles.backButtonText}>Back</Text>
      </TouchableOpacity>
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
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#475569',
    marginBottom: 16,
  },
  profileCard: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    padding: 14,
    marginBottom: 14,
  },
  label: {
    color: '#64748b',
    fontSize: 12,
    textTransform: 'uppercase',
    marginBottom: 4,
    marginTop: 8,
  },
  value: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: '#ffffff',
    marginBottom: 10,
    color: '#0f172a',
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  dateFieldButton: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    marginBottom: 8,
  },
  dateFieldText: {
    color: '#0f172a',
    fontSize: 14,
  },
  dateFieldPlaceholder: {
    color: '#94a3b8',
  },
  incidentLocationInput: {
    marginTop: 3,
  },
  secondaryButton: {
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#737000',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    marginTop: 10,
  },
  secondaryButtonText: {
    color: '#737000',
    fontSize: 14,
    fontWeight: '700',
  },
  evidenceCountText: {
    marginTop: 8,
    marginBottom: 12,
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  primaryButton: {
    height: 48,
    borderRadius: 10,
    backgroundColor: '#737000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  mapPickerContainer: {
    marginTop: 10,
    marginBottom: 10,
  },
  mapHint: {
    fontSize: 13,
    color: '#475569',
    marginBottom: 8,
  },
  map: {
    height: 250,
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  mapActionRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 10,
  },
  mapCoordinatesText: {
    marginTop: 8,
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  mapActionButton: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  mapActionText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '600',
  },
  mapActionConfirm: {
    backgroundColor: '#737000',
    borderColor: '#737000',
  },
  mapActionConfirmText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  backButton: {
    marginTop: 16,
    height: 46,
    borderRadius: 10,
    backgroundColor: '#737000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
