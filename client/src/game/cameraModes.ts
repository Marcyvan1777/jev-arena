export type CameraMode = 'broadcast' | 'red' | 'blue' | 'orbit' | 'hall' | 'free';
export const CAMERA_MODES: Array<{ id: CameraMode; label: string }> = [
  { id: 'broadcast', label: 'BROADCAST' }, { id: 'red', label: 'RED CORNER' }, { id: 'blue', label: 'BLUE CORNER' }, { id: 'orbit', label: 'ORBIT' }, { id: 'hall', label: 'HALL' }, { id: 'free', label: 'FREE' },
];
