export interface DeviceElement { id: number; type: number; name: string; info: string }

export interface DeviceInfo {
  model: string; serial: string; mac: string; fwv: string;
  maxPower: number; ampacity: number; maxAmpacity: number;
  limitPower: number; selectorPower: number;
  elements: DeviceElement[];
  ocpp: boolean; modbus: boolean; solar: boolean; rfid: boolean;
}

export interface ModulatorStat {
  totalPower: number; evsePower: number; homePower: number;
  selectorPower: number; splDetected: boolean; mbusDetected: boolean;
}

export interface ModulatorCfg {
  limitPower: number; limitPowerByPhase: number[]; notifCycle: number;
}

export interface EvsmElement {
  name: string;
  stat: { event: number; state: number; idCharge: number; user: string; localtime: number };
}

export interface TimeSlot { hourMin: number; duration: number; maxPower?: number }

export interface SchedulerTask {
  id: number; active: boolean; user: string; group: number; priority: number;
  initTime: { day: number; month: number; weekday: number; timeList: TimeSlot[] };
}

export interface SchedulerElement {
  name: string;
  data: { uid: number; cfg: { tasks: SchedulerTask[]; defaultState: number } };
}

export interface SplCfg {
  splMode: number; splLimitPower: number; splLimitPowerByPhase: number[];
  splCount: number; splIndex: number;
}

export interface SolarCfg {
  enabled: boolean; injected: boolean; battery: boolean;
  maxFvPower: number; priority: number;
}

export interface HmiCfg { ledsIntensity: number }
