import { StatusBar } from 'expo-status-bar';

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons';
import { auth, db } from './firebaseConfig';
import CitizenDashboard from './CitizenDashboard';

const ALLOWED_DISTRICTS = [
  'Colombo',
  'Gampaha',
  'Kalutara',
  'Kandy',
  'Matale',
  'Nuwara Eliya',
  'Galle',
  'Matara',
  'Hambantota',
  'Jaffna',
  'Kilinochchi',
  'Mannar',
  'Mullaitivu',
  'Vavuniya',
  'Trincomalee',
  'Batticaloa',
  'Ampara',
  'Kurunegala',
  'Puttalam',
  'Anuradhapura',
  'Polonnaruwa',
  'Badulla',
  'Monaragala',
  'Ratnapura',
  'Kegalle',
];

const DISTRICT_LOOKUP = ALLOWED_DISTRICTS.reduce((acc, district) => {
  acc[district.toLowerCase()] = district;
  return acc;
}, {});

const normalizeDistrict = (district) => DISTRICT_LOOKUP[district.trim().toLowerCase()] || '';
const MAX_LOGIN_ATTEMPTS = 3;
const LOGIN_LOCK_MS = 60 * 1000;

export default function App() {
  const [isBooting, setIsBooting] = useState(true);
  const [showRegistration, setShowRegistration] = useState(false);
  const [loggedInCitizen, setLoggedInCitizen] = useState(null);
  const [loginForm, setLoginForm] = useState({
    citizenEmail: '',
    citizenPassword: '',
  });
  const [form, setForm] = useState({
    citizenName: '',
    citizenEmail: '',
    citizenContact: '',
    citizenDistrict: '',
    citizenNic: '',
    citizenPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [failedLoginAttempts, setFailedLoginAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState(null);
  const [lockSecondsRemaining, setLockSecondsRemaining] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsBooting(false);
    }, 2200);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!lockUntil) {
      setLockSecondsRemaining(0);
      return undefined;
    }

    const updateRemainingSeconds = () => {
      const remainingMs = lockUntil - Date.now();
      if (remainingMs <= 0) {
        setLockUntil(null);
        setLockSecondsRemaining(0);
        setFailedLoginAttempts(0);
        return;
      }

      setLockSecondsRemaining(Math.ceil(remainingMs / 1000));
    };

    updateRemainingSeconds();
    const intervalId = setInterval(updateRemainingSeconds, 1000);

    return () => clearInterval(intervalId);
  }, [lockUntil]);

  const isLoginLocked = lockUntil && lockUntil > Date.now();

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateLoginField = (field, value) => {
    setLoginForm((prev) => ({ ...prev, [field]: value }));
  };

  const validateLoginForm = () => {
    if (!loginForm.citizenEmail.trim()) {
      return 'CitizenEmail is required.';
    }

    if (!loginForm.citizenPassword.trim()) {
      return 'CitizenPassword is required.';
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(loginForm.citizenEmail.trim())) {
      return 'Please enter a valid email address.';
    }

    return '';
  };

  const validateForm = () => {
    const requiredFields = [
      ['CitizenName', form.citizenName],
      ['CitizenEmail', form.citizenEmail],
      ['CitizenContact', form.citizenContact],
      ['CitizenDistrict', form.citizenDistrict],
      ['CitizenNic', form.citizenNic],
      ['CitizenPassword', form.citizenPassword],
    ];

    const missing = requiredFields.find((item) => !item[1].trim());
    if (missing) {
      return `${missing[0]} is required.`;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(form.citizenEmail.trim())) {
      return 'Please enter a valid email address.';
    }

    const contactValue = form.citizenContact.trim();
    const contactPattern = /^\d{10}$/;
    if (!contactPattern.test(contactValue)) {
      return 'CitizenContact must contain exactly 10 digits and numbers only.';
    }

    if (!normalizeDistrict(form.citizenDistrict)) {
      return 'Invalid district. Please enter a valid Sri Lankan district.';
    }

    const nicValue = form.citizenNic.trim().toUpperCase();
    const oldNicPattern = /^\d{9}[VX]$/;
    const newNicPattern = /^\d{12}$/;

    if (!oldNicPattern.test(nicValue) && !newNicPattern.test(nicValue)) {
      return 'Invalid NIC. Use old format (123456789V/X) or new format (12 digits).';
    }

    if (form.citizenPassword.length < 6) {
      return 'Password must be at least 6 characters.';
    }

    return '';
  };

  const handleRegister = async () => {
    const validationError = validateForm();
    if (validationError) {
      Alert.alert('Validation Error', validationError);
      return;
    }

    setLoading(true);

    try {
      const normalizedContact = form.citizenContact.trim();
      const normalizedNic = form.citizenNic.trim().toUpperCase();
      const contactQuery = query(
        collection(db, 'citizens'),
        where('citizenContact', '==', normalizedContact),
        limit(1)
      );
      const existingContactSnapshot = await getDocs(contactQuery);

      if (!existingContactSnapshot.empty) {
        Alert.alert('Validation Error', 'Incorrect contact number. Please check your details and try again.');
        setLoading(false);
        return;
      }

      const nicQuery = query(collection(db, 'citizens'), where('citizenNic', '==', normalizedNic), limit(1));
      const existingNicSnapshot = await getDocs(nicQuery);

      if (!existingNicSnapshot.empty) {
        Alert.alert('Validation Error', 'Incorrect NIC. Please check your details and try again.');
        setLoading(false);
        return;
      }

      const credential = await createUserWithEmailAndPassword(
        auth,
        form.citizenEmail.trim(),
        form.citizenPassword
      );

      await setDoc(doc(db, 'citizens', credential.user.uid), {
        citizenName: form.citizenName.trim(),
        citizenEmail: form.citizenEmail.trim(),
        citizenContact: normalizedContact,
        citizenDistrict: normalizeDistrict(form.citizenDistrict),
        citizenNic: normalizedNic,
        citizenUid: credential.user.uid,
        createdAt: serverTimestamp(),
      });

      await signOut(auth);

      Alert.alert('Success', 'Citizen registered successfully.');
      setShowRegistration(false);
      setLoginForm({
        citizenEmail: form.citizenEmail.trim(),
        citizenPassword: '',
      });
      setForm({
        citizenName: '',
        citizenEmail: '',
        citizenContact: '',
        citizenDistrict: '',
        citizenNic: '',
        citizenPassword: '',
      });
    } catch (error) {
      Alert.alert('Registration Failed', error.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (isLoginLocked) {
      Alert.alert('Login Locked', `Too many failed attempts. Try again in ${lockSecondsRemaining} seconds.`);
      return;
    }

    const validationError = validateLoginForm();
    if (validationError) {
      Alert.alert('Validation Error', validationError);
      return;
    }

    setLoading(true);

    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        loginForm.citizenEmail.trim(),
        loginForm.citizenPassword
      );

      const citizenRef = doc(db, 'citizens', credential.user.uid);
      const citizenSnap = await getDoc(citizenRef);

      if (citizenSnap.exists()) {
        setLoggedInCitizen(citizenSnap.data());
      } else {
        setLoggedInCitizen({
          citizenUid: credential.user.uid,
          citizenEmail: credential.user.email,
          citizenName: 'Citizen',
        });
      }

      setFailedLoginAttempts(0);
      setLockUntil(null);

      Alert.alert('Success', 'Login successful.');
    } catch (error) {
      const nextFailedAttempts = failedLoginAttempts + 1;

      if (nextFailedAttempts >= MAX_LOGIN_ATTEMPTS) {
        setFailedLoginAttempts(0);
        setLockUntil(Date.now() + LOGIN_LOCK_MS);
        Alert.alert('Login Locked', 'Too many failed attempts. Login is locked for 1 minute.');
      } else {
        setFailedLoginAttempts(nextFailedAttempts);
        const remainingAttempts = MAX_LOGIN_ATTEMPTS - nextFailedAttempts;
        Alert.alert(
          'Login Failed',
          `${error.message || 'Invalid credentials.'} You have ${remainingAttempts} attempt(s) left.`
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setLoggedInCitizen(null);
      setLoginForm({ citizenEmail: '', citizenPassword: '' });
      setShowRegistration(false);
    } catch (error) {
      Alert.alert('Logout Failed', error.message || 'Something went wrong.');
    }
  };

  if (isBooting) {
    return (
      <SafeAreaView style={styles.bootScreen}>
        <StatusBar style="dark" />
        <View style={styles.bootContent}>
          <Image source={require('./assets/Logo.png')} style={styles.bootLogo} resizeMode="contain" />
          <Text style={styles.bootSubtitle}>Your Safety Starts Here!</Text>
          <ActivityIndicator size="large" color="#1E3A8A" style={styles.bootLoader} />
        </View>
      </SafeAreaView>
    );
  }

  if (loggedInCitizen) {
    return <CitizenDashboard citizen={loggedInCitizen} onLogout={handleLogout} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {showRegistration ? (
          <>
            <Text style={styles.title}>Create your account</Text>
           

            <TextInput
              style={styles.input}
              placeholder="Enter your name"
              value={form.citizenName}
              onChangeText={(text) => updateField('citizenName', text)}
            />
            <TextInput
              style={styles.input}
              placeholder="Enter your email"
              keyboardType="email-address"
              
              autoCapitalize="none"
              value={form.citizenEmail}
              onChangeText={(text) => updateField('citizenEmail', text)}
            />
            <TextInput
              style={styles.input}
              placeholder="Enter your contact number"
              keyboardType="phone-pad"
              value={form.citizenContact}
              onChangeText={(text) => updateField('citizenContact', text)}
            />
            <TextInput
              style={styles.input}
              placeholder="Enter your district"
              value={form.citizenDistrict}
              onChangeText={(text) => updateField('citizenDistrict', text)}
            />
            <TextInput
              style={styles.input}
              placeholder="Enter your NIC"
              autoCapitalize="characters"
              value={form.citizenNic}
              onChangeText={(text) => updateField('citizenNic', text)}
            />
            <TextInput
              style={styles.input}
              placeholder="Enter your password"
              secureTextEntry
              value={form.citizenPassword}
              onChangeText={(text) => updateField('citizenPassword', text)}
            />

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.buttonText}>Register</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setShowRegistration(false)} style={styles.switchLinkWrap}>
              <Text style={styles.switchLink}>Already have an account? Login</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={styles.loginHero}>
              
              <Text style={styles.loginWelcome}>Welcome back</Text>
              
            </View>

            <View style={styles.loginCard}>
             
             

              {isLoginLocked ? (
                <View style={styles.lockNotice}>
                  <Ionicons name="lock-closed-outline" size={18} color="#b91c1c" />
                  <Text style={styles.lockText}>
                    Login locked. Try again in {lockSecondsRemaining} seconds.
                  </Text>
                </View>
              ) : null}

              <Text style={styles.loginFieldLabel}>Email address</Text>
              <View style={styles.loginInputWrap}>
                <Ionicons name="mail-outline" size={19} color="#64748b" />
                <TextInput
                  style={styles.loginInput}
                  placeholder="Enter your email"
                  placeholderTextColor="#94a3b8"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={loginForm.citizenEmail}
                  onChangeText={(text) => updateLoginField('citizenEmail', text)}
                />
              </View>

              <Text style={styles.loginFieldLabel}>Password</Text>
              <View style={styles.loginInputWrap}>
                <Ionicons name="lock-closed-outline" size={19} color="#64748b" />
                <TextInput
                  style={styles.loginInput}
                  placeholder="Enter your password"
                  placeholderTextColor="#94a3b8"
                  secureTextEntry
                  value={loginForm.citizenPassword}
                  onChangeText={(text) => updateLoginField('citizenPassword', text)}
                />
              </View>

              <TouchableOpacity
                style={[styles.loginButton, (loading || isLoginLocked) && styles.buttonDisabled]}
                onPress={handleLogin}
                disabled={loading || isLoginLocked}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <>
                    <Text style={styles.loginButtonText}>Sign In</Text>
                   
                  </>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.registerPrompt}>
              <Text style={styles.registerPromptText}>Don't have an account?</Text>
              <TouchableOpacity onPress={() => setShowRegistration(true)}>
                <Text style={styles.registerPromptLink}>Create an account</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bootScreen: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bootContent: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  bootLogo: {
    width: 250,
    height: 250,
  },
  bootSubtitle: {
    marginTop: 15,
    fontSize: 16,
    color: '#475569',
  },
  bootLoader: {
    marginTop: 24,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  container: {
    padding: 20,
    paddingTop: 36,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 20,
    alignSelf: 'center',
    
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 20,
    alignSelf: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    backgroundColor: '#ffffff',
    fontSize: 15,
    color: '#0f172a',
  },
  button: {
    marginTop: 8,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#1E3A8A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  switchLinkWrap: {
    marginTop: 16,
    alignItems: 'center',
  },
  switchLink: {
    color: '#1E3A8A',
    fontSize: 14,
    fontWeight: '700',
  },
  lockText: {
    color: '#b91c1c',
    fontSize: 14,
    flex: 1,
    fontWeight: '600',
  },
  loginHero: {
    alignItems: 'center',
    marginBottom: 20,
  },
  loginLogo: {
    width: 150,
    height: 92,
    marginBottom: 8,
  },
  loginWelcome: {
    color: '#0f172a',
    fontSize: 29,
    fontWeight: '800',
    marginBottom: 6,
  },
  loginSubtitle: {
    color: '#64748b',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
  },
  loginCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  loginCardTitle: {
    color: '#1e3a8a',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 5,
  },
  loginCardSubtitle: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 20,
  },
  lockNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 11,
    marginBottom: 16,
  },
  loginFieldLabel: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 7,
  },
  loginInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 11,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 13,
    marginBottom: 16,
  },
  loginInput: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 11,
    fontSize: 15,
    color: '#0f172a',
  },
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 50,
    borderRadius: 11,
    backgroundColor: '#1e3a8a',
    marginTop: 4,
  },
  loginButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  registerPrompt: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    marginTop: 22,
  },
  registerPromptText: {
    color: '#64748b',
    fontSize: 13,
  },
  registerPromptLink: {
    color: '#1E3A8A',
    fontSize: 13,
    fontWeight: '800',
  },
});
