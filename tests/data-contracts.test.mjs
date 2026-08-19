import test from "node:test";
import assert from "node:assert/strict";
import {
  createDeviceRecord,
  deviceCsvTemplate,
  devicesForMode,
  parseDeviceCsv,
} from "../src/devices.js";
import { PROJECT_SCHEMA, PROJECT_VERSION, createProjectFile, normalizeProjectFile } from "../src/project-file.js";

test("device CSV template round-trips and customer mode hides unapproved records", () => {
  const devices = parseDeviceCsv(deviceCsvTemplate());
  assert.equal(devices.length, 2);
  assert.equal(devicesForMode(devices, "speaker", false).length, 0);
  assert.equal(devicesForMode(devices, "speaker", true).length, 1);
});

test("device records reject unknown types and unsafe URLs", () => {
  assert.throws(() => createDeviceRecord({ deviceType: "sub", brand: "A", model: "B" }));
  const speaker = createDeviceRecord({ deviceType: "speaker", brand: "A", model: "B", sourceUrl: "javascript:alert(1)" });
  assert.equal(speaker.sourceUrl, null);
});

test("project file v2 preserves calculation inputs and migrates v1", () => {
  const file = createProjectFile({
    appVersion: "3.1.0",
    calculationModel: "acousticore-screening-v2",
    project: { projectName: "Demo", seatCount: 4 },
    configuration: { experience: "reference", roomLength: 8, subwooferQuantity: 2 },
    resources: { devices: [{ deviceId: "speaker-1" }], customModels: [{ modelKey: "custom-1" }] },
  });
  assert.equal(file.schema, PROJECT_SCHEMA);
  assert.equal(file.version, PROJECT_VERSION);
  assert.equal(file.configuration.roomLength, 8);
  assert.equal(file.resources.devices.length, 1);
  const migrated = normalizeProjectFile({ version: 1, experience: "daily", roomLength: 5 });
  assert.equal(migrated.configuration.experience, "daily");
  assert.equal(migrated.configuration.roomLength, 5);
});
