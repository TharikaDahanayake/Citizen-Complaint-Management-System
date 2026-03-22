import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function Profile({ citizen, onLogout }) {
  return (
    <View style={styles.page}>
      <Text style={styles.heading}>Profile</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Name</Text>
        <Text style={styles.value}>{citizen?.citizenName || '-'}</Text>

        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{citizen?.citizenEmail || '-'}</Text>

        <Text style={styles.label}>Contact</Text>
        <Text style={styles.value}>{citizen?.citizenContact || '-'}</Text>

        <Text style={styles.label}>District</Text>
        <Text style={styles.value}>{citizen?.citizenDistrict || '-'}</Text>

        <Text style={styles.label}>NIC</Text>
        <Text style={styles.value}>{citizen?.citizenNic || '-'}</Text>
      </View>

      <TouchableOpacity style={styles.button} onPress={onLogout}>
        <Text style={styles.buttonText}>Logout</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    padding: 20,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    padding: 16,
  },
  label: {
    marginTop: 8,
    fontSize: 12,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    marginTop: 4,
    fontSize: 16,
    color: '#0f172a',
    fontWeight: '600',
  },
  button: {
    marginTop: 20,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#737000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
