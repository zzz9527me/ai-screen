export const IPC = {
  SettingsGet: 'settings:get',
  SettingsSave: 'settings:save',
  PickFolder: 'dialog:pick-folder',
  ListWindows: 'sources:list-windows',
  RegionSelect: 'region:select',
  CaptureStart: 'capture:start',
  CaptureStop: 'capture:stop',
  DialogClose: 'dialog:close',

  CaptureReady: 'capture:ready',
  CaptureChunk: 'capture:chunk',
  CaptureFinished: 'capture:finished',
  RegionSelected: 'region:selected',
  RegionCancelled: 'region:cancelled',

  CaptureBegin: 'capture:begin',
  CaptureAbort: 'capture:abort',
  StateChanged: 'state:changed',
  ToastError: 'toast:error',
  SettingsChanged: 'settings:changed'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
