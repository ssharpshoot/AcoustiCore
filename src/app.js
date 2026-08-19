import { CATALOG_META, SUBWOOFER_CATALOG } from "../data/subwoofer-catalog-v2.5.js";
import {
  EXPERIENCE_LEVELS,
  describeCapacity,
  formatDbRange,
  mainChannelCapacity,
  requiredPower,
  requiredSensitivity,
  roundDb,
  subwooferCapacity,
} from "./calculations.js";
import {
  ASSESSMENT_STATUSES,
  CALCULATION_MODEL_VERSION,
  EVIDENCE_GRADES,
  assessSubwooferCapacity,
  axialRoomModes,
  evidenceGradeForTest,
  legacySubwooferProxy,
  seatConsistencyAssessment,
} from "./assessment.js";
import {
  createCustomModel,
  exportCustomModels,
  getPrimaryTest,
  getTestById,
  loadCustomModels,
  normalizeCustomImport,
  saveCustomModels,
  searchModels,
} from "./catalog.js";
import { bindRangePair } from "./ui-utils.js";
import { APP_META } from "./meta.js";
import {
  createDeviceRecord,
  deviceCsvTemplate,
  devicesForMode,
  exportDevices,
  loadDevices,
  normalizeDeviceImport,
  parseDeviceCsv,
  saveDevices,
} from "./devices.js";
import { createProjectFile, normalizeProjectFile } from "./project-file.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const elements = {
  roomLength: $("#roomLength"),
  roomWidth: $("#roomWidth"),
  roomHeight: $("#roomHeight"),
  listeningDistance: $("#listeningDistance"),
  sensitivity: $("#speakerSensitivity"),
  sensitivityBasis: $("#sensitivityBasis"),
  impedance: $("#speakerImpedance"),
  power: $("#amplifierPower"),
  speakerContinuousPower: $("#speakerContinuousPower"),
  speakerMaxSpl: $("#speakerMaxSpl"),
  powerEvidence: $("#powerEvidence"),
  speakerDeviceSelect: $("#speakerDeviceSelect"),
  amplifierDeviceSelect: $("#amplifierDeviceSelect"),
  subwooferQuantity: $("#subwooferQuantity"),
  subwooferSearch: $("#subwooferSearch"),
  subwooferResults: $("#subwooferResults"),
  selectedSubwoofer: $("#selectedSubwoofer"),
  alternateTestSelect: $("#alternateTestSelect"),
  evidencePanel: $("#salesEvidence"),
  evidenceToggle: $("#evidenceToggle"),
  legacyProxyPanel: $("#legacyProxyPanel"),
  legacyProxySize: $("#legacyProxySize"),
  legacyProxyPower: $("#legacyProxyPower"),
  legacyProxyType: $("#legacyProxyType"),
};

const baseline = {
  sensitivity: Number(elements.sensitivity.value),
  power: Number(elements.power.value),
  distance: Number(elements.listeningDistance.value),
  quantity: Number(elements.subwooferQuantity.value),
};

const state = {
  experience: "immersive",
  customModels: loadCustomModels(),
  selectedModel: null,
  selectedTestId: null,
  lastAdjusted: null,
  evidenceOpen: false,
  devices: loadDevices(),
  activeSearchIndex: -1,
  toastTimer: null,
};

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2800);
}

function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function currentExperience() {
  return EXPERIENCE_LEVELS[state.experience];
}

function readMainInputs(overrides = {}) {
  return {
    sensitivity: overrides.sensitivity ?? Number(elements.sensitivity.value),
    sensitivityBasis: elements.sensitivityBasis.value,
    impedance: Number(elements.impedance.value),
    powerWatts: overrides.power ?? Number(elements.power.value),
    distanceMeters: overrides.distance ?? Number(elements.listeningDistance.value),
    evidence: elements.powerEvidence.value,
    speakerContinuousPowerWatts: Number(elements.speakerContinuousPower.value) || null,
    speakerMaxSplDb: Number(elements.speakerMaxSpl.value) || null,
  };
}

function selectedTest() {
  return getTestById(state.selectedModel, state.selectedTestId);
}

function makeTag(text, tone = "neutral") {
  const tag = document.createElement("span");
  tag.className = `evidence-label ${tone}`;
  tag.textContent = text;
  return tag;
}

function renderExperience() {
  for (const option of $$(".experience-option")) {
    option.classList.toggle("selected", $("input", option).checked);
  }
  const experience = currentExperience();
  $("#experienceTargetLabel").textContent = `${experience.label} · AcoustiCore 筛选阈值 ${experience.mainTargetDb} / ${experience.lfeTargetDb} dB`;
}

function renderRoom() {
  const length = Number(elements.roomLength.value);
  const width = Number(elements.roomWidth.value);
  const height = Number(elements.roomHeight.value);
  $("#roomSummary").textContent = `${(length * width * height).toFixed(1)} m³`;
  const modes = axialRoomModes({ length, width, height });
  $("#roomModeSummary").textContent = modes
    ? `轴向基频：长 ${modes.length[0].frequency.toFixed(1)} Hz · 宽 ${modes.width[0].frequency.toFixed(1)} Hz · 高 ${modes.height[0].frequency.toFixed(1)} Hz。仅提示几何模态风险，不包含墙体损耗、开口或实际座位响应。`
    : "房间尺寸不足，无法计算轴向模态提示。";
}

function renderSelectedModel() {
  const root = elements.selectedSubwoofer;
  root.replaceChildren();
  if (!state.selectedModel) {
    root.append(makeTag("尚未选择低音炮", "warning"));
    return;
  }

  const model = state.selectedModel;
  const title = document.createElement("div");
  title.className = "selected-product-copy";
  const name = document.createElement("strong");
  name.textContent = `${model.brand} ${model.model}`;
  const specs = document.createElement("span");
  const woofer = model.specs.wooferCount && model.specs.wooferSizeIn
    ? `${model.specs.wooferCount} × ${model.specs.wooferSizeIn} 英寸`
    : model.specs.wooferText || "单元规格未完整记录";
  specs.textContent = `${woofer} · ${model.specs.type || "箱体形式未标注"}`;
  title.append(name, specs);

  const tags = document.createElement("div");
  tags.className = "selected-product-tags";
  if (model.dataTier === "measured" && model.primaryTestId) {
    const grade = evidenceGradeForTest(getPrimaryTest(model));
    tags.append(makeTag(
      grade === EVIDENCE_GRADES.VERIFIED_MEASUREMENT ? "已审核实测记录" : "实测记录｜治理信息待补",
      grade === EVIDENCE_GRADES.VERIFIED_MEASUREMENT ? "success" : "warning",
    ));
  } else if (model.dataTier === "measured") {
    tags.append(makeTag("多记录待人工确认", "warning"));
  } else if (model.dataTier === "customSpec") {
    tags.append(makeTag("本机自定义规格", "neutral"));
  } else {
    tags.append(makeTag("规格参考｜暂无 CEA/CTA 实测", "warning"));
  }
  root.append(title, tags);
  renderLegacyProxyInputs();
}

function renderLegacyProxyInputs() {
  const model = state.selectedModel;
  const usesProxy = model && !selectedTest();
  elements.legacyProxyPanel.hidden = !usesProxy;
  if (!usesProxy) return;

  if (!elements.legacyProxySize.value) {
    elements.legacyProxySize.value = model.specs?.wooferSizeIn || "";
  }
  if (!elements.legacyProxyPower.value) {
    elements.legacyProxyPower.value = model.specs?.amplifierPower || "";
  }
}

function testOptionLabel(test) {
  const points = Object.keys(test.measurements).length;
  return `${test.standard} · ${test.testMode} · ${test.source} · ${points} 个频点`;
}

function renderTestSelector() {
  const select = elements.alternateTestSelect;
  select.replaceChildren();
  const model = state.selectedModel;
  if (!model?.tests?.length) {
    const option = document.createElement("option");
    option.textContent = "暂无实测记录";
    option.value = "";
    select.append(option);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = model.primaryTestId ? "使用客户主记录" : "未选择（客户视图不生成容量）";
  select.append(empty);

  const standards = [...new Set(model.tests.map((test) => test.standard))];
  for (const standard of standards) {
    const group = document.createElement("optgroup");
    group.label = `${standard}（仅在本组内比较）`;
    for (const test of model.tests.filter((item) => item.standard === standard)) {
      const option = document.createElement("option");
      option.value = test.testId;
      option.textContent = `${test.testId === model.primaryTestId ? "主记录｜" : "替代测试｜"}${testOptionLabel(test)}`;
      group.append(option);
    }
    select.append(group);
  }
  select.value = state.selectedTestId === model.primaryTestId ? "" : (state.selectedTestId || "");
}

function renderEvidence(mainCapacity, test) {
  const basisText = elements.sensitivityBasis.value === "2.83v" ? "2.83V/1m" : "1W/1m";
  $("#mainFormulaText").textContent = `规划值 = 灵敏度 + 10×log₁₀(功率) − 20×log₁₀(距离)。当前按 ${basisText}、${elements.impedance.value} Ω、${elements.power.value} W、${elements.listeningDistance.value} m 计算。`;
  $("#sensitivityConversionText").textContent = elements.sensitivityBasis.value === "2.83v"
    ? `${elements.sensitivity.value} dB（2.83V/1m）换算为约 ${mainCapacity.sensitivity1W.toFixed(1)} dB（1W/1m）；仅做电压标注口径换算，不推断阻抗曲线。`
    : "灵敏度已按 1W/1m 输入，无需电压口径换算。";

  const evidence = $("#subwooferEvidenceText");
  const governance = $("#evidenceGovernanceText");
  if (!state.selectedModel || !test) {
    evidence.textContent = state.selectedModel?.dataTier === "measured"
      ? "该型号的多条记录尚未确认客户主记录。销售可在下方选择替代测试，但不会改写数据库默认值。"
      : "该型号只有规格资料，不生成绝对低频容量。";
    governance.textContent = state.selectedModel
      ? "若填写口径、功率与箱体形式，旧公式只输出低置信度单值，结论永久为“暂定估算”。"
      : "请选择型号后查看证据状态。";
    return;
  }

  const alternateMark = test.testId !== state.selectedModel.primaryTestId ? "替代测试｜" : "客户主记录｜";
  evidence.textContent = `${alternateMark}${test.standard}，${test.testMode}，${test.basisDistanceM} m，${test.measurementType}，来源：${test.source}。不同标准不会放在同一比较基线上。`;
  const grade = evidenceGradeForTest(test);
  governance.textContent = grade === EVIDENCE_GRADES.VERIFIED_MEASUREMENT
    ? `证据等级：verified_measurement；记录 ${test.testId} 已具备来源链接、许可状态与人工审核。`
    : `证据等级：traceable_measurement；记录 ${test.testId} 尚缺具体来源链接、许可确认或人工审核，因此只能显示“暂定估算”。`;
}

function renderFrequencyValues(capacity, singleCapacity, test) {
  const root = $("#frequencyValues");
  root.replaceChildren();
  const shownFrequencies = [20, 25, 31.5, 40, 50, 63];

  if (!capacity || !test) {
    for (const frequency of shownFrequencies) {
      const item = document.createElement("div");
      item.className = "frequency-cell";
      item.innerHTML = `<span>${frequency} Hz</span><strong>—</strong><small>无同口径实测</small>`;
      root.append(item);
    }
    return;
  }

  for (const frequency of shownFrequencies) {
    const value = capacity.values[String(frequency)];
    const item = document.createElement("div");
    item.className = "frequency-cell";
    const label = document.createElement("span");
    const nominal = document.createElement("strong");
    const range = document.createElement("small");
    label.textContent = `${frequency} Hz`;
    nominal.textContent = value ? `${roundDb(value.nominal)} dB` : "—";
    const single = singleCapacity?.values[String(frequency)];
    const quantity = Number(elements.subwooferQuantity.value);
    range.textContent = value
      ? (quantity > 1 && single
          ? `1只 ${roundDb(single.nominal)} → ${quantity}只 ${roundDb(value.nominal)} · 范围 ${roundDb(value.low)}–${roundDb(value.high)}`
          : `规划范围 ${roundDb(value.low)}–${roundDb(value.high)} dB`)
      : "该记录无此频点";
    item.append(label, nominal, range);
    root.append(item);
  }
}

function currentLegacyProxy() {
  if (!state.selectedModel || selectedTest()) return null;
  return legacySubwooferProxy({
    wooferSizeIn: elements.legacyProxySize.value || state.selectedModel.specs?.wooferSizeIn,
    amplifierPowerWatts: elements.legacyProxyPower.value || state.selectedModel.specs?.amplifierPower,
    enclosureType: elements.legacyProxyType.value || state.selectedModel.specs?.type,
    quantity: Number(elements.subwooferQuantity.value),
    listeningDistanceMeters: Number(elements.listeningDistance.value),
  });
}

function renderAssessmentSummary(subAssessment, seatAssessment, legacyProxy) {
  const capacityStatus = $("#subCapacityStatus");
  const capacityReason = $("#subCapacityReason");
  capacityStatus.className = "";
  if (legacyProxy) {
    capacityStatus.textContent = "暂定估算";
    capacityStatus.classList.add("warning");
    capacityReason.textContent = `旧规格公式约 ${roundDb(legacyProxy.nominal)} dB；不可用于达标判断。`;
  } else if (!subAssessment || subAssessment.status === ASSESSMENT_STATUSES.INSUFFICIENT) {
    capacityStatus.textContent = "信息不足";
    capacityStatus.classList.add("warning");
    capacityReason.textContent = "缺少可比较的六频点数据。";
  } else {
    capacityStatus.textContent = subAssessment.label;
    capacityStatus.classList.add(
      subAssessment.status === ASSESSMENT_STATUSES.SCREENING_PASS ? "success"
        : subAssessment.status === ASSESSMENT_STATUSES.SCREENING_SHORTFALL ? "danger" : "warning",
    );
    const weakest = subAssessment.weakestBand;
    capacityReason.textContent = weakest
      ? `${weakest.frequency} Hz 是当前最弱筛选频点；阈值为 AcoustiCore 规划值。`
      : "当前记录没有足够频点。";
  }

  const seatStatus = $("#seatConsistencyStatus");
  seatStatus.textContent = seatAssessment.label;
  seatStatus.className = seatAssessment.key;
  $("#seatConsistencyReason").textContent = seatAssessment.reason;

  $("#legacyProxyValue").textContent = legacyProxy ? `约 ${roundDb(legacyProxy.nominal)} dB` : "信息不足";
}

function renderDiagnosis(mainCapacity, mainDescription, subAssessment, test, legacyProxy, seatAssessment) {
  const experience = currentExperience();
  const diagnosis = $("#primaryDiagnosis");
  const labels = $("#evidenceLabels");
  labels.replaceChildren();

  if (mainCapacity.high < experience.mainTargetDb) {
    const gap = Math.max(1, Math.round(experience.mainTargetDb - mainCapacity.nominal));
    diagnosis.textContent = `当前最关键的短板是主声道动态余量：按现有距离、灵敏度和功率估算，中心值距目标约 ${gap} dB。优先提高音箱灵敏度通常比单纯堆功率更有效。`;
    labels.append(makeTag(`主声道 ${mainDescription.label}`, "warning"));
    return;
  }

  if (!test) {
    if (legacyProxy) {
      diagnosis.textContent = `当前低频只有 ${legacyProxy.modelVersion} 旧规格公式的单值估算。它没有 Xmax、箱体调谐、DSP 限幅和失真阈值，不能替代 CEA/CTA 六频点实测。`;
      labels.append(makeTag("旧公式｜暂定估算", "warning"));
    } else {
      diagnosis.textContent = state.selectedModel?.dataTier === "measured"
        ? "当前最关键的问题不是数量，而是同型号存在未确认的测试配置。先确认端口、DSP、供电或硬件版本，再谈容量筛选。"
        : "当前最关键的数据缺口是低音炮没有同口径 CEA/CTA 实测，且旧规格公式所需参数不完整。";
      labels.append(makeTag("低频信息不足", "warning"));
    }
    if (seatAssessment.key === "warning") labels.append(makeTag("多座位建议两只起", "warning"));
    return;
  }

  const weakest = subAssessment?.weakestBand;
  if (subAssessment?.status === ASSESSMENT_STATUSES.PROVISIONAL) {
    diagnosis.textContent = `测试数据提示 ${weakest?.frequency ?? "部分"} Hz 是当前最弱筛选频点，但来源链接、许可或人工审核尚未闭环，因此结果只能作为暂定估算。`;
    labels.append(makeTag("traceable_measurement｜暂定", "warning"));
    if (seatAssessment.key === "warning") labels.append(makeTag("两只建议来自座位一致性", "warning"));
    return;
  }

  if (subAssessment?.status === ASSESSMENT_STATUSES.SCREENING_SHORTFALL) {
    diagnosis.textContent = `已审核数据在 ${weakest.frequency} Hz 的保守规划范围低于 AcoustiCore 筛选阈值。增加数量可改善容量，但不能代替摆位与多座位测量。`;
    labels.append(makeTag(`${weakest.frequency} Hz 筛选缺口`, "warning"));
    return;
  }

  diagnosis.textContent = "已审核六频点数据通过 AcoustiCore 规划筛选。该结论仍不是 Dolby、THX 认证，最终结果必须通过摆位、分频、相位、延时和多座位测量确认。";
  labels.append(makeTag("数据初筛通过", "success"));
}

function renderRecommendations(mainCapacity, subCapacity, singleSubCapacity, test, legacyProxy, singleLegacyProxy) {
  const experience = currentExperience();
  const neededSensitivity = requiredSensitivity({
    targetDb: experience.mainTargetDb,
    powerWatts: Number(elements.power.value),
    distanceMeters: Number(elements.listeningDistance.value),
    outputBasis: elements.sensitivityBasis.value,
    impedance: Number(elements.impedance.value),
  });
  const neededPower = requiredPower({
    targetDb: experience.mainTargetDb,
    sensitivity: Number(elements.sensitivity.value),
    sensitivityBasis: elements.sensitivityBasis.value,
    impedance: Number(elements.impedance.value),
    distanceMeters: Number(elements.listeningDistance.value),
  });
  const basis = elements.sensitivityBasis.value === "2.83v" ? "2.83V/1m" : "1W/1m";
  $("#requiredSensitivityText").textContent = `保持功放不变：音箱灵敏度约需 ${Math.ceil(neededSensitivity)} dB（${basis}）起。`;
  $("#requiredPowerText").textContent = `保持音箱不变：理论功率约需 ${Math.ceil(neededPower / 5) * 5} W/声道；还需核实音箱承受能力和功放负载条件。`;

  const currentNominal = roundDb(mainChannelCapacity(readMainInputs({
    sensitivity: baseline.sensitivity,
    power: baseline.power,
    distance: baseline.distance,
  })).nominal);
  const adjustedNominal = roundDb(mainCapacity.nominal);
  const quantity = Number(elements.subwooferQuantity.value);
  const currentSub40 = singleSubCapacity?.values["40"];
  const adjustedSub40 = subCapacity?.values["40"];
  const compareMeasuredSubs = state.lastAdjusted === "quantity" && test && currentSub40 && adjustedSub40;
  const compareProxySubs = state.lastAdjusted === "quantity" && !test && legacyProxy && singleLegacyProxy;
  const compareSubwoofers = compareMeasuredSubs || compareProxySubs;
  const currentSubValue = compareMeasuredSubs ? currentSub40.nominal : singleLegacyProxy?.nominal;
  const adjustedSubValue = compareMeasuredSubs ? adjustedSub40.nominal : legacyProxy?.nominal;
  $("#comparisonCurrent").textContent = compareSubwoofers ? `1只 · ${roundDb(currentSubValue)} dB` : `${currentNominal} dB`;
  $("#comparisonAdjusted").textContent = compareSubwoofers ? `${quantity}只 · ${roundDb(adjustedSubValue)} dB` : `${adjustedNominal} dB`;

  const changes = [];
  const sensitivityChange = Number(elements.sensitivity.value) - baseline.sensitivity;
  const powerRatio = Number(elements.power.value) / baseline.power;
  const distanceChange = Number(elements.listeningDistance.value) - baseline.distance;
  if (Math.abs(sensitivityChange) >= 0.25) changes.push(`灵敏度变化 ${sensitivityChange > 0 ? "+" : ""}${sensitivityChange.toFixed(1)} dB`);
  if (Math.abs(powerRatio - 1) >= 0.02) changes.push(`功率变为原来的 ${powerRatio.toFixed(1)} 倍`);
  if (Math.abs(distanceChange) >= 0.05) changes.push(`听音距离变化 ${distanceChange > 0 ? "+" : ""}${distanceChange.toFixed(1)} m`);
  if (compareSubwoofers) {
    const proxyWarning = compareProxySubs ? " 此处为旧规格公式暂定值，不可用于达标判断。" : "";
    $("#upgradeSuggestion").textContent = `从 1 只调整为 ${quantity} 只，保守能量叠加约增加 ${Math.round(adjustedSubValue - currentSubValue)} dB；更重要的是增加摆位自由度，最终多座位一致性仍需现场测量。${proxyWarning}`;
  } else {
    $("#upgradeSuggestion").textContent = changes.length
      ? `${changes.join("、")}，主声道中心估算由约 ${currentNominal} dB 变为 ${adjustedNominal} dB。滑杆显示的是方案差异，不是现场验收值。`
      : "拖动灵敏度、功率或听音距离滑杆，客户可以立即看到哪项调整更有效。";
  }
}

function renderSubwooferTier(test) {
  const model = state.selectedModel;
  const tier = $("#subwooferDataTier");
  if (!model) {
    tier.textContent = "未选择型号";
  } else if (!test) {
    tier.textContent = model.dataTier === "measured" ? "实测记录待确认" : "规格参考｜旧公式仅暂定";
  } else if (test.testId !== model.primaryTestId) {
    tier.textContent = `替代测试｜${test.standard}｜暂定`;
  } else {
    tier.textContent = evidenceGradeForTest(test) === EVIDENCE_GRADES.VERIFIED_MEASUREMENT
      ? `已审核实测｜${test.standard}`
      : `实测记录｜${test.standard}｜暂定`;
  }
}

function renderPrint(mainCapacity, mainDescription, subCapacity, test, subAssessment, evidenceGrade, legacyProxy, seatAssessment) {
  $("#printDate").textContent = `生成时间：${new Date().toLocaleString("zh-CN")}`;
  $("#printVersion").textContent = `应用 ${APP_META.version} · 构建 ${APP_META.commit} · 计算模型 ${CALCULATION_MODEL_VERSION} · 报告 ${APP_META.reportVersion}`;
  const content = $("#printContent");
  content.replaceChildren();
  const experience = currentExperience();
  const room = `${elements.roomLength.value} × ${elements.roomWidth.value} × ${elements.roomHeight.value} m，主听音距离 ${elements.listeningDistance.value} m`;
  const modelName = state.selectedModel ? `${state.selectedModel.brand} ${state.selectedModel.model}` : "未选择";
  const subText = subCapacity && test
    ? [20, 25, 31.5, 40, 50, 63].map((frequency) => {
        const value = subCapacity.values[String(frequency)];
        return `${frequency} Hz ${value ? `${roundDb(value.nominal)} dB` : "无数据"}`;
      }).join("；")
    : (legacyProxy ? `旧规格公式约 ${roundDb(legacyProxy.nominal)} dB（${legacyProxy.modelVersion}，永久暂定）` : "暂无可用于容量筛选的同口径数据");
  const projectLabel = $("#projectName").value || "未命名项目";
  const clientLabel = $("#clientName").value || "未填写";
  const consultantLabel = $("#consultant").value || "未填写";
  const sourceText = test
    ? `${test.standard} / ${test.testMode} / ${test.source} / 记录 ${test.testId} / ${test.sourceUrl || "具体来源链接待补"}`
    : (legacyProxy ? `${legacyProxy.modelVersion} / legacy_proxy` : "规格参考或主记录待确认");
  const rows = [
    ["项目", `${projectLabel}；客户 ${clientLabel}；销售顾问 ${consultantLabel}`],
    ["空间", `${room}；${$("#roomType").selectedOptions[0].textContent}；${$("#seatCount").value} 个座位；${$("#openSpace").checked ? "与其他空间连通" : "相对封闭"}`],
    ["规划筛选阈值", `${experience.label}：主声道 ${experience.mainTargetDb} dB / 低频 ${experience.lfeTargetDb} dB。该阈值不是官方认证线。`],
    ["当前配置", `音箱灵敏度 ${elements.sensitivity.value} dB（${elements.sensitivityBasis.value === "2.83v" ? "2.83V/1m" : "1W/1m"}），功放 ${elements.power.value} W/声道（${elements.impedance.value} Ω），低音炮 ${modelName} × ${elements.subwooferQuantity.value}`],
    ["理论直达声压估算", `${formatDbRange(mainCapacity)}；${mainDescription.label}。不包含功率压缩、指向性、阻抗曲线和房间响应。`],
    ["低频输出容量", `${modelName} × ${elements.subwooferQuantity.value}；${subText}；结论 ${legacyProxy ? "暂定估算" : (subAssessment?.label || "信息不足")}`],
    ["多座位一致性", `${seatAssessment.label}；${seatAssessment.reason}`],
    ["主要短板", $("#primaryDiagnosis").textContent],
    ["升级前后", `${$("#comparisonCurrent").textContent} → ${$("#comparisonAdjusted").textContent}。${$("#upgradeSuggestion").textContent}`],
    ["数据依据", `${sourceText}；证据等级 ${evidenceGrade}`],
    ["关键假设", "自由场距离衰减、功率可用且口径正确、多炮仅按保守能量叠加；不使用固定房间增益、固定分频奖励或 4Ω 自动功率倍增。"],
    ["风险", legacyProxy
      ? "旧规格公式缺少 Xmax、箱体调谐、DSP 限幅和失真阈值，只能作为低置信度销售初筛。"
      : (test && evidenceGrade !== EVIDENCE_GRADES.VERIFIED_MEASUREMENT
          ? "来源链接、许可状态或人工审核未闭环，低频结论只能暂定。"
          : "现场声学条件仍可能改变结果。")],
    ["待现场验证", "摆位、分频、相位、延时、EQ 与多座位一致性"],
  ];
  for (const [label, value] of rows) {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    const paragraph = document.createElement("p");
    heading.textContent = label;
    paragraph.textContent = value;
    section.append(heading, paragraph);
    content.append(section);
  }
}

function update() {
  renderExperience();
  renderRoom();
  const experience = currentExperience();
  const mainCapacity = mainChannelCapacity(readMainInputs());
  const mainDescription = describeCapacity(mainCapacity, experience.mainTargetDb);
  const test = selectedTest();
  let evidenceGrade = test ? evidenceGradeForTest(test) : EVIDENCE_GRADES.MANUFACTURER_SPEC;
  const subCapacity = test ? subwooferCapacity({
    measurements: test.measurements,
    quantity: Number(elements.subwooferQuantity.value),
    listeningDistanceMeters: Number(elements.listeningDistance.value),
    measurementDistanceMeters: test.basisDistanceM,
    uncertaintyDb: 4,
  }) : null;
  const singleSubCapacity = test ? subwooferCapacity({
    measurements: test.measurements,
    quantity: 1,
    listeningDistanceMeters: Number(elements.listeningDistance.value),
    measurementDistanceMeters: test.basisDistanceM,
    uncertaintyDb: 4,
  }) : null;
  const subAssessment = assessSubwooferCapacity({
    capacity: subCapacity,
    targetDb: experience.lfeTargetDb,
    evidenceGrade,
  });
  const legacyProxy = currentLegacyProxy();
  if (legacyProxy) evidenceGrade = EVIDENCE_GRADES.LEGACY_PROXY;
  const singleLegacyProxy = legacyProxy ? legacySubwooferProxy({
    wooferSizeIn: elements.legacyProxySize.value || state.selectedModel?.specs?.wooferSizeIn,
    amplifierPowerWatts: elements.legacyProxyPower.value || state.selectedModel?.specs?.amplifierPower,
    enclosureType: elements.legacyProxyType.value,
    quantity: 1,
    listeningDistanceMeters: Number(elements.listeningDistance.value),
  }) : null;
  const seatAssessment = seatConsistencyAssessment({
    quantity: Number(elements.subwooferQuantity.value),
    seatCount: Number($("#seatCount").value),
    openSpace: $("#openSpace").checked,
  });

  $("#mainCapacityValue").textContent = `约 ${roundDb(mainCapacity.nominal)} dB`;
  $("#mainCapacityRange").textContent = `规划范围 ${roundDb(mainCapacity.low)}–${roundDb(mainCapacity.high)} dB`;
  const status = $("#mainStatus");
  status.className = `status-line ${mainDescription.key}`;
  const centerGap = roundDb(mainCapacity.nominal - experience.mainTargetDb);
  const gapText = centerGap === 0 ? "中心值接近目标" : `中心值较目标 ${centerGap > 0 ? "+" : ""}${centerGap} dB`;
  const limiterText = mainCapacity.powerLimited
    ? ` · 已按音箱持续功率 ${roundDb(mainCapacity.effectivePowerWatts)} W 限制`
    : (mainCapacity.maxSplLimited ? " · 已按厂家最大 SPL 限制" : "");
  status.textContent = `理论直达声压：${mainDescription.label} · ${gapText}${limiterText}`;
  $("#confidenceBadge").textContent = elements.powerEvidence.value === "traceable" ? "参数计算 · ±3 dB" : "规格参考 · ±5 dB";

  renderLegacyProxyInputs();
  renderSubwooferTier(test);
  renderFrequencyValues(subCapacity, singleSubCapacity, test);
  renderAssessmentSummary(subAssessment, seatAssessment, legacyProxy);
  renderDiagnosis(mainCapacity, mainDescription, subAssessment, test, legacyProxy, seatAssessment);
  renderRecommendations(mainCapacity, subCapacity, singleSubCapacity, test, legacyProxy, singleLegacyProxy);
  renderEvidence(mainCapacity, test);
  renderPrint(mainCapacity, mainDescription, subCapacity, test, subAssessment, evidenceGrade, legacyProxy, seatAssessment);
}

function setSelectedModel(model) {
  state.selectedModel = model;
  state.selectedTestId = model?.primaryTestId ?? null;
  elements.subwooferSearch.value = model ? `${model.brand} ${model.model}` : "";
  elements.subwooferResults.hidden = true;
  elements.subwooferSearch.setAttribute("aria-expanded", "false");
  elements.subwooferSearch.removeAttribute("aria-activedescendant");
  state.activeSearchIndex = -1;
  elements.legacyProxySize.value = model?.specs?.wooferSizeIn || "";
  elements.legacyProxyPower.value = model?.specs?.amplifierPower || "";
  const knownType = model?.specs?.type || "";
  const matchingType = [...elements.legacyProxyType.options].find((option) => knownType.includes(option.value.replace("式", "")));
  if (matchingType) elements.legacyProxyType.value = matchingType.value;
  renderSelectedModel();
  renderTestSelector();
  update();
}

function renderSearchResults() {
  const results = searchModels(SUBWOOFER_CATALOG, state.customModels, elements.subwooferSearch.value);
  const root = elements.subwooferResults;
  root.replaceChildren();
  state.activeSearchIndex = -1;
  elements.subwooferSearch.removeAttribute("aria-activedescendant");
  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "search-empty";
    empty.textContent = "未找到型号。可使用“手动添加型号”保存为本机规格。";
    root.append(empty);
  } else {
    results.forEach((model, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";
      button.setAttribute("role", "option");
      button.id = `subwoofer-option-${index}`;
      button.setAttribute("aria-selected", "false");
      button.dataset.modelKey = model.modelKey;
      const title = document.createElement("strong");
      const meta = document.createElement("small");
      title.textContent = `${model.brand} ${model.model}`;
      meta.textContent = model.dataTier === "measured"
        ? (model.primaryTestId ? "有主实测记录" : "实测配置待确认")
        : (model.dataTier === "customSpec" ? "本机自定义规格" : "规格参考｜暂无实测");
      button.append(title, meta);
      button.addEventListener("click", () => setSelectedModel(model));
      root.append(button);
    });
  }
  root.hidden = false;
  elements.subwooferSearch.setAttribute("aria-expanded", "true");
}

function moveSearchActive(direction) {
  const options = $$('.search-result', elements.subwooferResults);
  if (!options.length) return;
  state.activeSearchIndex = (state.activeSearchIndex + direction + options.length) % options.length;
  options.forEach((option, index) => option.setAttribute("aria-selected", String(index === state.activeSearchIndex)));
  const active = options[state.activeSearchIndex];
  elements.subwooferSearch.setAttribute("aria-activedescendant", active.id);
  active.scrollIntoView({ block: "nearest" });
}

function selectedDevice(deviceId) {
  return state.devices.find((device) => device.deviceId === deviceId) ?? null;
}

function renderDeviceSelectors() {
  for (const [select, type, label] of [
    [elements.speakerDeviceSelect, "speaker", "手动输入参数"],
    [elements.amplifierDeviceSelect, "amplifier", "手动输入参数"],
  ]) {
    const current = select.value;
    select.replaceChildren(new Option(label, ""));
    for (const device of devicesForMode(state.devices, type, state.evidenceOpen)) {
      const risk = device.reviewStatus === "approved" ? "已审核" : "草稿";
      select.append(new Option(`${device.brand} ${device.model} · ${risk}`, device.deviceId));
    }
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }
}

function applyDevice(device) {
  if (!device) return;
  if (device.deviceType === "speaker") {
    elements.sensitivity.value = device.sensitivityDb ?? elements.sensitivity.value;
    elements.sensitivityBasis.value = device.sensitivityBasis ?? "1w";
    elements.impedance.value = String(device.impedanceOhm ?? elements.impedance.value);
    elements.speakerContinuousPower.value = device.continuousPowerW ?? 0;
    elements.speakerMaxSpl.value = device.maxSplDb ?? 0;
  } else {
    const impedance = Number(elements.impedance.value);
    elements.power.value = impedance <= 4
      ? (device.power4OhmW ?? device.power8OhmW ?? elements.power.value)
      : (device.power8OhmW ?? device.power4OhmW ?? elements.power.value);
  }
  for (const container of $$('[data-range-pair]')) {
    const number = $('input[type="number"]', container);
    const range = $('input[type="range"]', container);
    range.value = number.value;
  }
  elements.powerEvidence.value = device.reviewStatus === "approved" && device.sourceUrl ? "traceable" : "spec";
  update();
}

function projectPayload() {
  return createProjectFile({
    appVersion: APP_META.version,
    calculationModel: CALCULATION_MODEL_VERSION,
    project: {
      projectName: $("#projectName").value,
      clientName: $("#clientName").value,
      consultant: $("#consultant").value,
      roomType: $("#roomType").value,
      openSpace: $("#openSpace").checked,
      seatCount: Number($("#seatCount").value),
    },
    configuration: {
      experience: state.experience,
      roomLength: Number(elements.roomLength.value),
      roomWidth: Number(elements.roomWidth.value),
      roomHeight: Number(elements.roomHeight.value),
      listeningDistance: Number(elements.listeningDistance.value),
      speakerSensitivity: Number(elements.sensitivity.value),
      sensitivityBasis: elements.sensitivityBasis.value,
      speakerImpedance: Number(elements.impedance.value),
      speakerContinuousPower: Number(elements.speakerContinuousPower.value),
      speakerMaxSpl: Number(elements.speakerMaxSpl.value),
      amplifierPower: Number(elements.power.value),
      powerEvidence: elements.powerEvidence.value,
      speakerDeviceId: elements.speakerDeviceSelect.value,
      amplifierDeviceId: elements.amplifierDeviceSelect.value,
      subwooferModelKey: state.selectedModel?.modelKey,
      subwooferTestId: state.selectedTestId,
      subwooferQuantity: Number(elements.subwooferQuantity.value),
      legacyProxyPower: Number(elements.legacyProxyPower.value),
      legacyProxyType: elements.legacyProxyType.value,
    },
    measurement: { status: "not-imported", rewReference: null },
    resources: { customModels: state.customModels, devices: state.devices },
  });
}

function applyProject(project) {
  const normalized = normalizeProjectFile(project);
  const { configuration, project: metadata } = normalized;
  for (const [id, value] of Object.entries({
    projectName: metadata.projectName,
    clientName: metadata.clientName,
    consultant: metadata.consultant,
    roomType: metadata.roomType,
    seatCount: metadata.seatCount,
    roomLength: configuration.roomLength,
    roomWidth: configuration.roomWidth,
    roomHeight: configuration.roomHeight,
    listeningDistance: configuration.listeningDistance,
    speakerSensitivity: configuration.speakerSensitivity,
    sensitivityBasis: configuration.sensitivityBasis,
    speakerImpedance: configuration.speakerImpedance,
    speakerContinuousPower: configuration.speakerContinuousPower,
    speakerMaxSpl: configuration.speakerMaxSpl,
    amplifierPower: configuration.amplifierPower,
    powerEvidence: configuration.powerEvidence,
    subwooferQuantity: configuration.subwooferQuantity,
    legacyProxyPower: configuration.legacyProxyPower,
    legacyProxyType: configuration.legacyProxyType,
  })) {
    const control = $(`#${id}`);
    if (control) control.value = String(value ?? "");
  }
  $("#openSpace").checked = metadata.openSpace;
  state.experience = configuration.experience;
  const experienceRadio = $(`input[name="experience"][value="${configuration.experience}"]`);
  if (experienceRadio) experienceRadio.checked = true;
  state.customModels = normalizeCustomImport(normalized.resources?.customModels ?? []);
  state.devices = normalizeDeviceImport(normalized.resources?.devices ?? []);
  saveCustomModels(state.customModels);
  saveDevices(state.devices);
  renderDeviceSelectors();
  elements.speakerDeviceSelect.value = configuration.speakerDeviceId || "";
  elements.amplifierDeviceSelect.value = configuration.amplifierDeviceId || "";
  for (const container of $$('[data-range-pair]')) {
    const number = $('input[type="number"]', container);
    $('input[type="range"]', container).value = number.value;
  }
  const model = [...state.customModels, ...SUBWOOFER_CATALOG].find((item) => item.modelKey === configuration.subwooferModelKey) ?? null;
  setSelectedModel(model);
  elements.legacyProxyPower.value = configuration.legacyProxyPower || model?.specs?.amplifierPower || "";
  elements.legacyProxyType.value = configuration.legacyProxyType || "密闭式";
  state.selectedTestId = configuration.subwooferTestId || model?.primaryTestId || null;
  setQuantity(configuration.subwooferQuantity);
  state.lastAdjusted = null;
  renderTestSelector();
  update();
}

function bindRangePairs() {
  for (const container of $$('[data-range-pair]')) {
    const number = $('input[type="number"]', container);
    const range = $('input[type="range"]', container);
    const adjustmentKeys = {
      speakerSensitivity: "sensitivity",
      amplifierPower: "power",
      listeningDistance: "distance",
    };
    bindRangePair(number, range, () => {
      state.lastAdjusted = adjustmentKeys[number.id] ?? null;
      update();
    });
  }
}

function setQuantity(value) {
  const next = Math.max(1, Math.min(8, Number(value) || 1));
  elements.subwooferQuantity.value = String(next);
  state.lastAdjusted = "quantity";
  for (const preset of $$("[data-quantity]")) {
    preset.classList.toggle("active", Number(preset.dataset.quantity) === next);
  }
  update();
}

function bindExperienceHelp() {
  for (const trigger of $$(".help-trigger")) {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const option = trigger.closest(".experience-option");
      const willOpen = !option.classList.contains("popover-open");
      for (const other of $$(".experience-option")) other.classList.remove("popover-open");
      option.classList.toggle("popover-open", willOpen);
      trigger.setAttribute("aria-expanded", String(willOpen));
    });
  }
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".experience-option")) {
      for (const option of $$(".experience-option")) option.classList.remove("popover-open");
    }
  });
}

function bindCustomModels() {
  const dialog = $("#customSubwooferDialog");
  const form = $("#customSubwooferForm");
  $("#customSubwooferButton").addEventListener("click", () => dialog.showModal());
  for (const closeButton of $$('[data-dialog-close]', dialog)) {
    closeButton.addEventListener("click", () => dialog.close());
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const input = Object.fromEntries(new FormData(form));
      const model = createCustomModel(input);
      state.customModels = [...state.customModels.filter((item) => item.modelKey !== model.modelKey), model];
      const persisted = saveCustomModels(state.customModels);
      form.reset();
      dialog.close();
      setSelectedModel(model);
      showToast(persisted
        ? "自定义型号已保存在本机；因无同口径实测，不生成绝对容量。"
        : "型号已在本次使用中添加；当前浏览器禁止持久保存，请导出 JSON 备份。");
    } catch (error) {
      showToast(error.message);
    }
  });

  $("#exportCustomButton").addEventListener("click", () => {
    downloadBlob(
      exportCustomModels(state.customModels),
      "application/json",
      `acousticore-custom-subwoofers-${new Date().toISOString().slice(0, 10)}.json`,
    );
    showToast(`已导出 ${state.customModels.length} 个本机自定义型号。`);
  });

  $("#importCustomInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      const imported = normalizeCustomImport(JSON.parse(await file.text()));
      state.customModels = [...new Map([...state.customModels, ...imported].map((item) => [item.modelKey, item])).values()];
      const persisted = saveCustomModels(state.customModels);
      showToast(persisted
        ? `已导入 ${imported.length} 个型号，数据仅保存在本机。`
        : `已导入 ${imported.length} 个型号供本次使用；请导出 JSON 备份。`);
    } catch (error) {
      showToast(`导入失败：${error.message}`);
    } finally {
      event.target.value = "";
    }
  });
}

function bindDeviceLibrary() {
  const dialog = $("#deviceLibraryDialog");
  const form = $("#deviceRecordForm");
  $("#deviceLibraryButton").addEventListener("click", () => dialog.showModal());
  for (const closeButton of $$('[data-device-dialog-close]', dialog)) {
    closeButton.addEventListener("click", () => dialog.close());
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const device = createDeviceRecord(Object.fromEntries(new FormData(form)));
      state.devices = [...new Map([...state.devices, device].map((item) => [item.deviceId, item])).values()];
      const persisted = saveDevices(state.devices);
      state.evidenceOpen = true;
      elements.evidencePanel.hidden = false;
      elements.evidenceToggle.setAttribute("aria-expanded", "true");
      elements.evidenceToggle.textContent = "收起数据依据";
      renderDeviceSelectors();
      const select = device.deviceType === "speaker" ? elements.speakerDeviceSelect : elements.amplifierDeviceSelect;
      select.value = device.deviceId;
      applyDevice(device);
      form.reset();
      dialog.close();
      showToast(persisted ? "设备已加入本机库并按当前参数应用。" : "设备已用于本次会话，请导出设备库备份。");
    } catch (error) {
      showToast(error.message);
    }
  });
  $("#downloadDeviceTemplate").addEventListener("click", () => {
    downloadBlob(`\uFEFF${deviceCsvTemplate()}`, "text/csv;charset=utf-8", "acousticore-device-import-template.csv");
  });
  $("#exportDeviceLibrary").addEventListener("click", () => {
    downloadBlob(exportDevices(state.devices), "application/json", `acousticore-device-library-${new Date().toISOString().slice(0, 10)}.json`);
  });
  $("#importDeviceInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      const text = await file.text();
      const imported = file.name.toLowerCase().endsWith(".csv")
        ? parseDeviceCsv(text)
        : normalizeDeviceImport(JSON.parse(text));
      state.devices = [...new Map([...state.devices, ...imported].map((item) => [item.deviceId, item])).values()];
      saveDevices(state.devices);
      renderDeviceSelectors();
      showToast(`已导入 ${imported.length} 条设备记录；未审核记录只在销售模式显示。`);
    } catch (error) {
      showToast(`设备导入失败：${error.message}`);
    } finally {
      event.target.value = "";
    }
  });
  elements.speakerDeviceSelect.addEventListener("change", () => applyDevice(selectedDevice(elements.speakerDeviceSelect.value)));
  elements.amplifierDeviceSelect.addEventListener("change", () => applyDevice(selectedDevice(elements.amplifierDeviceSelect.value)));
}

function bindProjectFiles() {
  $("#exportProjectButton").addEventListener("click", () => {
    const project = projectPayload();
    const slug = project.project.projectName.replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-") || "project";
    downloadBlob(JSON.stringify(project, null, 2), "application/json", `acousticore-${slug}.json`);
    showToast("项目文件已导出，包含当前配置、本机设备和自定义低音炮。 ");
  });
  $("#importProjectInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      applyProject(JSON.parse(await file.text()));
      showToast("项目已重新加载并完成版本兼容处理。");
    } catch (error) {
      showToast(`项目导入失败：${error.message}`);
    } finally {
      event.target.value = "";
    }
  });
}

function bindStepRail() {
  if (!("IntersectionObserver" in window)) return;
  const links = $$(".step-rail a");
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    links.forEach((link) => link.classList.toggle("active", link.hash === `#${visible.target.id}`));
  }, { rootMargin: "-20% 0px -65%", threshold: [0.1, 0.5] });
  for (const section of [$("#experienceSection"), $("#configurationSection"), $("#resultSection")]) observer.observe(section);
}

function bindEvents() {
  bindRangePairs();
  bindExperienceHelp();
  bindCustomModels();
  bindDeviceLibrary();
  bindProjectFiles();
  bindStepRail();

  for (const radio of $$('input[name="experience"]')) {
    radio.addEventListener("change", () => {
      state.experience = radio.value;
      update();
    });
  }
  for (const select of [elements.sensitivityBasis, elements.impedance, elements.powerEvidence, elements.legacyProxyType, $("#roomType")]) {
    select.addEventListener("change", update);
  }
  for (const input of [elements.legacyProxySize, elements.legacyProxyPower, $("#seatCount"), $("#openSpace"), $("#projectName"), $("#clientName"), $("#consultant")]) {
    input.addEventListener("input", update);
    input.addEventListener("change", update);
  }

  elements.subwooferSearch.addEventListener("input", renderSearchResults);
  elements.subwooferSearch.addEventListener("focus", renderSearchResults);
  elements.subwooferSearch.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (elements.subwooferResults.hidden) renderSearchResults();
      moveSearchActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && state.activeSearchIndex >= 0) {
      event.preventDefault();
      $$('.search-result', elements.subwooferResults)[state.activeSearchIndex]?.click();
    } else if (event.key === "Escape") {
      elements.subwooferResults.hidden = true;
      elements.subwooferSearch.setAttribute("aria-expanded", "false");
      elements.subwooferSearch.removeAttribute("aria-activedescendant");
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".subwoofer-search-wrap")) {
      elements.subwooferResults.hidden = true;
      elements.subwooferSearch.setAttribute("aria-expanded", "false");
      elements.subwooferSearch.removeAttribute("aria-activedescendant");
    }
  });

  $("#quantityMinus").addEventListener("click", () => setQuantity(Number(elements.subwooferQuantity.value) - 1));
  $("#quantityPlus").addEventListener("click", () => setQuantity(Number(elements.subwooferQuantity.value) + 1));
  for (const preset of $$("[data-quantity]")) {
    preset.addEventListener("click", () => setQuantity(preset.dataset.quantity));
  }

  elements.alternateTestSelect.addEventListener("change", () => {
    state.selectedTestId = elements.alternateTestSelect.value || state.selectedModel?.primaryTestId || null;
    update();
  });

  elements.evidenceToggle.addEventListener("click", () => {
    state.evidenceOpen = !state.evidenceOpen;
    if (!state.evidenceOpen) {
      state.selectedTestId = state.selectedModel?.primaryTestId ?? null;
      renderTestSelector();
    }
    elements.evidencePanel.hidden = !state.evidenceOpen;
    elements.evidenceToggle.setAttribute("aria-expanded", String(state.evidenceOpen));
    elements.evidenceToggle.textContent = state.evidenceOpen ? "收起数据依据" : "查看数据依据";
    renderDeviceSelectors();
    if (state.evidenceOpen) elements.evidencePanel.scrollIntoView({ behavior: "smooth", block: "start" });
    update();
  });

  $("#printButton").addEventListener("click", () => window.print());
}

function initialize() {
  $("#appVersion").textContent = `v${APP_META.version}${APP_META.commit === "local" ? "" : ` · ${APP_META.commit}`}`;
  bindEvents();
  renderDeviceSelectors();
  const preferred = SUBWOOFER_CATALOG.find((item) => /kube 10b/i.test(item.model) && item.primaryTestId)
    || SUBWOOFER_CATALOG.find((item) => item.primaryTestId)
    || null;
  state.experience = $('input[name="experience"]:checked').value;
  setSelectedModel(preferred);
  console.info("AcoustiCore catalog", CATALOG_META);
}

initialize();
