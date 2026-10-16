// -----------------------------------------------------------------------------
// Answers of the Panasonic cloud for Aquarea heat pumps, WRITTEN FOR THESE
// TESTS: neither aioaquarea nor aio-panasonic-comfort-cloud ship test data.
// The field names, nesting and value codes are the ones their parsers read
// (aioaquarea 1.0.7 device_manager.py / data.py / statistics.py,
// aio-panasonic-comfort-cloud models/aquarea.py, apiclient/_devices.py); the
// values are invented. Replace them with real answers (anonymized) when
// testers send some (TODO.md, milestone 2).
// -----------------------------------------------------------------------------

export const GUID = '008007B767718332';
export const GUID_2 = '008007B767718999';

/** GET /device/group: one Aquarea (deviceType "2") next to an air conditioner. */
export const groups = {
  groupCount: 1,
  groupList: [
    {
      groupId: 112233,
      groupName: 'Maison',
      deviceList: [
        {
          deviceGuid: GUID,
          deviceType: '2',
          deviceName: 'PAC maison',
          permission: 3,
          deviceModuleNumber: 'WH-MDC09J3E5',
          deviceHashGuid: 'f3b0c4',
          summerHouse: 0,
          iAutoX: false,
        },
        {
          deviceGuid: 'CS-Z25XKEW+1234567890',
          deviceType: '3',
          deviceName: 'Clim salon',
          permission: 3,
          deviceModuleNumber: 'CS-Z25XKEW',
          parameters: { operate: 0, operationMode: 3, temperatureSet: 21 },
        },
      ],
    },
  ],
};

/**
 * The status of a heat pump with two zones (zone 1 on a compensation curve,
 * zone 2 direct), cooling, a tank, heating the rooms.
 */
export const statusTwoZones = () => ({
  a2wName: 'PAC maison',
  operation: 'A',
  ownerFlg: true,
  status: {
    operationStatus: 1,
    operationMode: 1,
    deiceStatus: 0,
    direction: 1,
    pumpDuty: 1,
    outdoorNow: 7,
    coolMode: 1,
    quietMode: 2,
    powerful: 0,
    forceDHW: 0,
    forceHeater: 0,
    holidayTimer: 0,
    specialStatus: 0,
    faultStatus: [],
    modelSeriesSelection: 2,
    tankStatus: {
      operationStatus: 1,
      temperatureNow: 48,
      heatMin: 40,
      heatMax: 65,
      heatSet: 50,
    },
    zoneStatus: [
      {
        zoneId: 1,
        zoneName: 'Rez-de-chaussée',
        operationStatus: 1,
        temperatureNow: 21,
        heatMin: -5,
        heatMax: 5,
        heatSet: 2,
        coolMin: -5,
        coolMax: 5,
        coolSet: 0,
        ecoHeat: -2,
        comfortHeat: 2,
        ecoCool: 2,
        comfortCool: -2,
      },
      {
        zoneId: 2,
        zoneName: 'Étage',
        operationStatus: 1,
        temperatureNow: 35,
        heatMin: 20,
        heatMax: 55,
        heatSet: 38,
        coolMin: 5,
        coolMax: 20,
        coolSet: 18,
      },
    ],
  },
});

/** A heat-only heat pump, one zone, its tank being heated, an error H62 reported. */
export const statusHeatOnlyError = () => ({
  a2wName: 'PAC garage',
  status: {
    operationStatus: 1,
    operationMode: 1,
    deiceStatus: 1,
    direction: 2,
    outdoorNow: -3,
    coolMode: 0,
    quietMode: 0,
    powerful: 1,
    faultStatus: [{ errorCode: 'H62', errorMessage: 'Water flow switch abnormality' }],
    tankStatus: {
      operationStatus: 1,
      temperatureNow: 44,
      heatMin: 40,
      heatMax: 75,
      heatSet: 52,
    },
    zoneStatus: [
      {
        zoneId: 1,
        operationStatus: 1,
        temperatureNow: 126,
        heatMin: 20,
        heatMax: 55,
        heatSet: 35,
      },
      { zoneId: 2, operationStatus: 0, temperatureNow: 126 },
    ],
  },
});

/** The unit is on, but only for hot water: every zone is off. */
export const statusTankOnly = () => {
  const answer = statusTwoZones();
  answer.status.direction = 2;
  for (const zone of answer.status.zoneStatus) {
    zone.operationStatus = 0;
  }
  return answer;
};

/** The Aquarea service refused the request (HTTP 200): the adapter is offline. */
export const refusalOffline = {
  message: [{ errorCode: '2011-0002', errorMessage: 'Device is offline.' }],
};

/** The consumption of October 2026, asked on the 15th: day 15 is not finished. */
export const consumptionOctober = {
  dateString: '2026-10',
  energyShowing: 1,
  historyDataList: [
    {
      dataTime: '20261013',
      heatConsumption: 6.4,
      coolConsumption: 0,
      tankConsumption: 2.1,
      outdoorTemp: 9,
    },
    {
      dataTime: '20261014',
      heatConsumption: 7.25,
      coolConsumption: -255,
      tankConsumption: 1.9,
      outdoorTemp: 8,
    },
    {
      dataTime: '20261015',
      heatConsumption: 3.1,
      coolConsumption: 0,
      tankConsumption: 0.8,
      outdoorTemp: 7,
    },
    { dataTime: '20261016', heatConsumption: -255, coolConsumption: -255, tankConsumption: -255 },
    { dataTime: '20261012', heatConsumption: -255, coolConsumption: -255, tankConsumption: -255 },
  ],
};
