import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'kr.ac.hs.lmsnotifier',
  appName: '한신대 LMS',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_notify',
      iconColor: '#5C088C',
      sound: 'beep.wav',
    },
  },
};

export default config;
