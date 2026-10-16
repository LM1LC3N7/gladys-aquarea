// -----------------------------------------------------------------------------
// What a HeishaMon publishes, WRITTEN FOR THESE TESTS: the topic names are
// those of its documentation (Egyras/HeishaMon MQTT-Topics.md), the values
// are invented but in the ranges a running Aquarea shows. The HeishaMon
// repository has no licence: nothing is copied from it.
//
// `dump()`: the retained values a broker hands at the subscription
// (`main/<Name>` -> text), for a monobloc heating its rooms with a tank,
// zone 1 only, on a compensation curve, with an older data block (no extra).
// -----------------------------------------------------------------------------

export const BASE = 'panasonic_heat_pump';

export const dump = () => ({
  'main/Heatpump_State': '1',
  'main/Pump_Flow': '16.42',
  'main/Force_DHW_State': '0',
  'main/Quiet_Mode_Schedule': '0',
  'main/Operating_Mode_State': '4',
  'main/Main_Inlet_Temp': '30.25',
  'main/Main_Outlet_Temp': '34.5',
  'main/Main_Target_Temp': '35',
  'main/Compressor_Freq': '38',
  'main/DHW_Target_Temp': '50',
  'main/DHW_Temp': '47',
  'main/Operations_Hours': '12873',
  'main/Operations_Counter': '5321',
  'main/Main_Schedule_State': '0',
  'main/Outside_Temp': '6',
  'main/Heat_Power_Production': '3200',
  'main/Heat_Power_Consumption': '800',
  'main/Powerful_Mode_Time': '0',
  'main/Quiet_Mode_Level': '1',
  'main/Holiday_Mode_State': '0',
  'main/ThreeWay_Valve_State': '0',
  'main/Outside_Pipe_Temp': '2',
  'main/DHW_Heat_Delta': '-5',
  'main/Heat_Delta': '5',
  'main/Cool_Delta': '5',
  'main/Defrosting_State': '0',
  'main/Z1_Heat_Request_Temp': '0',
  'main/Z1_Cool_Request_Temp': '0',
  'main/Z1_Heat_Curve_Target_High_Temp': '38',
  'main/Z1_Heat_Curve_Target_Low_Temp': '28',
  'main/Z1_Heat_Curve_Outside_High_Temp': '15',
  'main/Z1_Heat_Curve_Outside_Low_Temp': '-7',
  'main/Room_Thermostat_Temp': '20',
  'main/Z2_Heat_Request_Temp': '0',
  'main/Z2_Cool_Request_Temp': '0',
  'main/Z1_Water_Temp': '34',
  'main/Z2_Water_Temp': '-78',
  'main/Cool_Power_Production': '0',
  'main/Cool_Power_Consumption': '0',
  'main/DHW_Power_Production': '0',
  'main/DHW_Power_Consumption': '0',
  'main/Z1_Water_Target_Temp': '35',
  'main/Z2_Water_Target_Temp': '-78',
  'main/Error': 'No error',
  'main/Z1_Temp': '20.5',
  'main/Z2_Temp': '-78',
  'main/Heating_Mode': '0',
  'main/Cooling_Mode': '0',
  'main/Heat_Pump_Model': 'WH-MDC09J3E5',
  'main/Zones_State': '0',
  'main/DHW_Installed': '1',
  'main/Z1_Sensor_Settings': '2',
  'main/Z2_Sensor_Settings': '0',
  'main/Water_Pressure': '1.68',
  LWT: 'Online',
});

/** The extra data block of the newer heat pumps (the main power topics then read -200). */
export const extraBlock = () => ({
  'main/Heat_Power_Production': '-200',
  'main/Heat_Power_Consumption': '-200',
  'main/DHW_Power_Production': '-200',
  'main/DHW_Power_Consumption': '-200',
  'main/Cool_Power_Production': '-200',
  'main/Cool_Power_Consumption': '-200',
  'extra/Heat_Power_Consumption_Extra': '740',
  'extra/Cool_Power_Consumption_Extra': '0',
  'extra/DHW_Power_Consumption_Extra': '0',
  'extra/Heat_Power_Production_Extra': '3050',
  'extra/Cool_Power_Production_Extra': '0',
  'extra/DHW_Power_Production_Extra': '0',
});

/** The /json page of the board for a set of values (`{ heatpump: [...], ... }`). */
export function jsonPage(values = dump()) {
  const list = (group, prefix) =>
    Object.entries(values)
      .filter(([topic]) => topic.startsWith(`${group}/`))
      .map(([topic, value], i) => {
        const name = topic.slice(group.length + 1);
        const number = Number(value);
        return {
          Topic: `${prefix}${i}`,
          Name: name,
          Value: Number.isFinite(number) && value.trim() !== '' ? number : value,
          Description: 'Value',
        };
      });
  return JSON.stringify({
    heatpump: list('main', 'TOP'),
    'heatpump extra': list('extra', 'XTOP'),
    '1wire': [],
    s0: [],
  });
}
