/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Core types for columnar data structures */

export enum IfcTypeEnum {
  // Spatial structure
  IfcProject = 1,
  IfcSite = 2,
  IfcBuilding = 3,
  IfcBuildingStorey = 4,
  IfcSpace = 5,
  IfcFacility = 59,
  IfcFacilityPart = 60,
  IfcBridge = 61,
  IfcBridgePart = 62,
  IfcRoad = 63,
  IfcRoadPart = 64,
  IfcRailway = 65,
  IfcRailwayPart = 66,
  IfcMarineFacility = 67,
  // The two remaining concrete IfcFacilityPart subtypes. IfcMarinePart is the
  // part of an IfcMarineFacility (berth, quay, approach channel) and
  // IfcFacilityPartCommon the part of a generic IfcFacility — the exact
  // counterparts of IfcBridgePart / IfcRoadPart / IfcRailwayPart above, which
  // were listed while these two were not. Ids continue the #1075 block above
  // the platform-variant max rather than filling the 68/69 gap, for the reason
  // spelled out on IfcSpatialZone below.
  IfcMarinePart = 321,
  IfcFacilityPartCommon = 322,
  // IfcSpatialZone is a spatial structure element (modelled GFA volumes);
  // IfcZone is a grouping (IfcSystem) of spaces/zones. Ids are above the
  // current max to avoid colliding with platform-variant func_elem indices
  // stripped by the wasm-free typecheck lane (#1002) — added for #1075.
  IfcSpatialZone = 317,
  IfcZone = 318,
  // IfcSystem / IfcDistributionSystem are IfcGroup-family groupings (MEP
  // systems, distribution networks). Listed/coloured by membership like
  // IfcZone. Ids continue the #1075 block above the platform-variant max.
  IfcSystem = 319,
  IfcDistributionSystem = 320,

  // Building elements
  IfcWall = 10,
  IfcWallStandardCase = 11,
  IfcDoor = 12,
  IfcWindow = 13,
  IfcSlab = 14,
  IfcColumn = 15,
  IfcBeam = 16,
  IfcStair = 17,
  IfcRamp = 18,
  IfcRoof = 19,
  IfcCovering = 20,
  IfcCurtainWall = 21,
  IfcRailing = 22,
  IfcPile = 23,
  IfcMember = 24,
  IfcPlate = 25,
  IfcFooting = 26,
  IfcBuildingElementProxy = 27,
  IfcStairFlight = 28,
  IfcRampFlight = 29,
  IfcChimney = 31,
  IfcShadingDevice = 32,
  IfcBuildingElementPart = 33,

  // Openings
  IfcOpeningElement = 30,

  // Assemblies and structural
  IfcElementAssembly = 34,
  IfcReinforcingBar = 35,
  IfcReinforcingMesh = 36,
  IfcTendon = 37,
  IfcDiscreteAccessory = 38,
  IfcMechanicalFastener = 39,


  // MEP
  IfcDistributionElement = 40,
  IfcFlowTerminal = 41,
  IfcFlowSegment = 42,
  IfcFlowFitting = 43,
  IfcFlowController = 44,
  IfcFlowMovingDevice = 45,
  IfcFlowStorageDevice = 46,
  IfcFlowTreatmentDevice = 47,
  IfcEnergyConversionDevice = 48,
  IfcDuctSegment = 49,
  IfcPipeSegment = 50,
  IfcCableSegment = 51,

  // Furnishing
  IfcFurnishingElement = 52,
  IfcFurniture = 53,

  // Other product types
  IfcProxy = 54,
  IfcAnnotation = 55,
  IfcTransportElement = 56,
  IfcCivilElement = 57,
  IfcGeographicElement = 58,

  // IFC4x3 infrastructure leaves (issue with AB22.ifc, the railway fixture,
  // and any other infrastructure model — pre-fix every IfcCourse / IfcPavement
  // / IfcSignal / IfcReferent showed up as "Unknown" in the properties panel
  // even though the Rust geometry pipeline correctly identified the type).
  IfcCourse = 70,
  IfcPavement = 71,
  IfcKerb = 72,
  IfcMooringDevice = 73,
  IfcNavigationElement = 74,
  IfcTrackElement = 75,
  IfcVehicle = 76,
  IfcEarthworksElement = 77,
  IfcEarthworksFill = 78,
  IfcEarthworksCut = 79,
  IfcReferent = 80,
  IfcSign = 81,
  IfcSignal = 82,
  IfcGeotechnicalStratum = 83,
  IfcGeotechnicalAssembly = 84,
  IfcSolidStratum = 85,
  IfcVoidStratum = 86,
  IfcWaterStratum = 87,
  IfcPositioningElement = 88,
  IfcAlignment = 89,

  // Relationships
  IfcRelContainedInSpatialStructure = 100,
  IfcRelAggregates = 101,
  IfcRelDefinesByProperties = 102,
  IfcRelDefinesByType = 103,
  IfcRelAssociatesMaterial = 104,
  IfcRelAssociatesClassification = 105,
  IfcRelVoidsElement = 106,
  IfcRelFillsElement = 107,
  IfcRelConnectsPathElements = 108,
  IfcRelSpaceBoundary = 109,

  // Property definitions
  IfcPropertySet = 200,
  IfcPropertySingleValue = 201,
  IfcPropertyEnumeratedValue = 202,
  IfcPropertyBoundedValue = 203,
  IfcPropertyListValue = 204,
  IfcElementQuantity = 210,
  IfcQuantityLength = 211,
  IfcQuantityArea = 212,
  IfcQuantityVolume = 213,
  IfcQuantityCount = 214,
  IfcQuantityWeight = 215,

  // Types
  IfcWallType = 300,
  IfcDoorType = 301,
  IfcWindowType = 302,
  IfcSlabType = 303,
  IfcColumnType = 304,
  IfcBeamType = 305,
  IfcPileType = 306,
  IfcMemberType = 307,
  IfcPlateType = 308,
  IfcFootingType = 309,
  IfcCoveringType = 310,
  IfcRailingType = 311,
  IfcStairType = 312,
  IfcRampType = 313,
  IfcRoofType = 314,
  IfcCurtainWallType = 315,
  IfcBuildingElementProxyType = 316,

  // Curated IFC4.3 class catalogue (ids 1000+; moved off 321+ when upstream
  // took 321/322 for IfcMarinePart/IfcFacilityPartCommon). Extends the enum beyond the
  // originally hand-picked set so classes outside it (IfcSensor, IfcAlarm,
  // IfcAudioVisualAppliance, the MEP/distribution family, IFC4.3 infrastructure
  // and the abstract supertypes) resolve to a real enum member instead of
  // `Unknown`. Consequences: `getByType` can target them, and `getTypeName`
  // returns proper CamelCase instead of the raw uppercase STEP keyword.
  // Ids continue the block above the platform-variant max (see #1002 note).
  IfcActor = 1000,
  IfcActuator = 1001,
  IfcAirTerminal = 1002,
  IfcAirTerminalBox = 1003,
  IfcAirToAirHeatRecovery = 1004,
  IfcAlarm = 1005,
  IfcAlignmentCant = 1006,
  IfcAlignmentHorizontal = 1007,
  IfcAlignmentSegment = 1008,
  IfcAlignmentVertical = 1009,
  IfcAsset = 1010,
  IfcAudioVisualAppliance = 1011,
  IfcBearing = 1012,
  IfcBoiler = 1013,
  IfcBorehole = 1014,
  IfcBuiltElement = 1015,
  IfcBuiltSystem = 1016,
  IfcBurner = 1017,
  IfcCableCarrierFitting = 1018,
  IfcCableFitting = 1019,
  IfcCaissonFoundation = 1020,
  IfcChiller = 1021,
  IfcCoil = 1022,
  IfcCommunicationsAppliance = 1023,
  IfcCompressor = 1024,
  IfcCondenser = 1025,
  IfcControl = 1026,
  IfcController = 1027,
  IfcConveyorSegment = 1028,
  IfcCooledBeam = 1029,
  IfcCoolingTower = 1030,
  IfcDamper = 1031,
  IfcDeepFoundation = 1032,
  IfcDistributionBoard = 1033,
  IfcDistributionChamberElement = 1034,
  IfcDistributionCircuit = 1035,
  IfcDistributionPort = 1036,
  IfcDuctFitting = 1037,
  IfcDuctSilencer = 1038,
  IfcElectricAppliance = 1039,
  IfcElectricDistributionBoard = 1040,
  IfcElectricFlowStorageDevice = 1041,
  IfcElectricFlowTreatmentDevice = 1042,
  IfcElectricGenerator = 1043,
  IfcElectricMotor = 1044,
  IfcElectricTimeControl = 1045,
  IfcElement = 1046,
  IfcElementComponent = 1047,
  IfcEngine = 1048,
  IfcEvaporativeCooler = 1049,
  IfcEvaporator = 1050,
  IfcExternalSpatialElement = 1051,
  IfcExternalSpatialStructureElement = 1052,
  IfcFan = 1053,
  IfcFeatureElement = 1054,
  IfcFeatureElementAddition = 1055,
  IfcFeatureElementSubtraction = 1056,
  IfcFilter = 1057,
  IfcFireSuppressionTerminal = 1058,
  IfcFlowInstrument = 1059,
  IfcFlowMeter = 1060,
  IfcGeomodel = 1061,
  IfcGeoslice = 1062,
  IfcGeotechnicalElement = 1063,
  IfcGrid = 1064,
  IfcGroup = 1065,
  IfcHeatExchanger = 1066,
  IfcHumidifier = 1067,
  IfcImpactProtectionDevice = 1068,
  IfcInterceptor = 1069,
  IfcInventory = 1070,
  IfcJunctionBox = 1071,
  IfcLamp = 1072,
  IfcLightFixture = 1073,
  IfcLinearElement = 1074,
  IfcLinearPositioningElement = 1075,
  IfcLiquidTerminal = 1076,
  IfcMedicalDevice = 1077,
  IfcMobileTelecommunicationsAppliance = 1078,
  IfcMotorConnection = 1079,
  IfcObject = 1080,
  IfcObjectDefinition = 1081,
  IfcOccupant = 1082,
  IfcOutlet = 1083,
  IfcPipeFitting = 1084,
  IfcPort = 1085,
  IfcProcess = 1086,
  IfcProduct = 1087,
  IfcProjectionElement = 1088,
  IfcProtectiveDevice = 1089,
  IfcProtectiveDeviceTrippingUnit = 1090,
  IfcPump = 1091,
  IfcRail = 1092,
  IfcReinforcedSoil = 1093,
  IfcReinforcingElement = 1094,
  IfcResource = 1095,
  IfcRoot = 1096,
  IfcSanitaryTerminal = 1097,
  IfcSensor = 1098,
  IfcSolarDevice = 1099,
  IfcSpaceHeater = 1100,
  IfcSpatialElement = 1101,
  IfcSpatialStructureElement = 1102,
  IfcStackTerminal = 1103,
  IfcStructuralAction = 1104,
  IfcStructuralActivity = 1105,
  IfcStructuralAnalysisModel = 1106,
  IfcStructuralConnection = 1107,
  IfcStructuralItem = 1108,
  IfcStructuralLoadGroup = 1109,
  IfcStructuralMember = 1110,
  IfcStructuralReaction = 1111,
  IfcStructuralResultGroup = 1112,
  IfcSurfaceFeature = 1113,
  IfcSwitchingDevice = 1114,
  IfcSystemFurnitureElement = 1115,
  IfcTank = 1116,
  IfcTendonConduit = 1117,
  IfcTransformer = 1118,
  IfcTransportationDevice = 1119,
  IfcTubeBundle = 1120,
  IfcUnitaryControlElement = 1121,
  IfcUnitaryEquipment = 1122,
  IfcValve = 1123,
  IfcVibrationDamper = 1124,
  IfcVibrationIsolator = 1125,
  IfcVirtualElement = 1126,
  IfcVoidingFeature = 1127,
  IfcWasteTerminal = 1128,

  Unknown = 9999,
}

export enum PropertyValueType {
  String = 0,
  Real = 1,
  Integer = 2,
  Boolean = 3,
  Logical = 4,
  Label = 5,
  Identifier = 6,
  Text = 7,
  Enum = 8,
  Reference = 9,
  List = 10,
}

export enum QuantityType {
  Length = 0,
  Area = 1,
  Volume = 2,
  Count = 3,
  Weight = 4,
  Time = 5,
  /** `IfcQuantityNumber` — a dimensionless count-like value, IFC4X3+ only. */
  Number = 6,
}

export { RelationshipType } from './relationship-type.js';

export enum EntityFlags {
  /** Own `Representation` set (not `$`) — not a class guess, not aggregated children (#4666). */ HAS_GEOMETRY = 0b00000001,
  HAS_PROPERTIES = 0b00000010,
  HAS_QUANTITIES = 0b00000100,
  IS_TYPE = 0b00001000,
  IS_EXTERNAL = 0b00010000,
  HAS_OPENINGS = 0b00100000,
  IS_FILLING = 0b01000000,
}

export interface SpatialNode {
  expressId: number;
  type: IfcTypeEnum;
  name: string;
  /** IFC `LongName` (the descriptive name), when present and distinct from
   *  `name`. Spatial structure elements often carry an ISO 19650 code in `Name`
   *  ("01") and the human label in `LongName` ("Main Residence"); the hierarchy
   *  panel shows both (issue #1634). Undefined when the entity declares no
   *  LongName or it duplicates `name`. */
  longName?: string;
  elevation?: number;
  children: SpatialNode[];
  elements: number[];  // Direct contained elements
}

export interface SpatialHierarchy {
  project: SpatialNode;
  byStorey: Map<number, number[]>;    // storeyId -> element IDs
  byBuilding: Map<number, number[]>;  // buildingId -> element IDs
  bySite: Map<number, number[]>;      // siteId -> element IDs
  bySpace: Map<number, number[]>;     // spaceId -> element IDs
  storeyElevations: Map<number, number>;  // storeyId -> elevation (z)
  storeyHeights: Map<number, number>;     // storeyId -> floor-to-floor height (calculated from elevation differences)
  elementToStorey: Map<number, number>;  // elementId -> storeyId (reverse lookup)
  /**
   * elementId -> the nearest spatial container node that ultimately contains
   * it, at ANY level (storey, IfcSpace / IfcSpatialZone, or an infrastructure
   * IfcBridgePart / IfcRoadPart / …). Unlike `elementToStorey` (storey-only),
   * this also records aggregated descendants of a directly-contained element
   * (e.g. an IfcBeam aggregated into an IfcElementAssembly that is contained in
   * an IfcBridgePart), so the "immediate Container" lookup resolves under
   * non-storey containers too. Optional: legacy / non-parser hierarchies that
   * predate it fall back to `elementToStorey`.
   */
  elementToContainer?: Map<number, number>;
  ambiguousStorey?: Set<number>;  // elementIds with >1 storey declared via direct ContainsElements in source (elementToStorey's answer was a tie-break, #4311); optional, older hierarchies omit it
  /** Spatial nodes reachable from `IfcProject` via canonical-parent edges — the set
   * `SpatialHierarchyBuilder` resolved `elementToStorey`'s tie-break against, read by
   * `EntityNode.containedIn()` so it cannot decide reachability for itself and answer a
   * different storey (#4314). Absent on legacy / non-parser hierarchies, and absence
   * means "no reachability information", never "nothing is reachable". */
  reachableSpatialNodes?: Set<number>;

  // Helper methods
  getStoreyElements(storeyId: number): number[];
  getStoreyByElevation(z: number): number | null;
  getContainingSpace(elementId: number): number | null;
  getPath(elementId: number): SpatialNode[]; // Project → ... → Element
}

// Type conversion helpers. A row may coalesce onto an ANCESTOR
// (IFCDOORSTANDARDCASE -> IfcDoor) but never a sibling or child, which renames
// the element to a different IFC class; `type-enum-ancestry.test.ts` sweeps it.
const TYPE_STRING_TO_ENUM = new Map<string, IfcTypeEnum>([
  // Curated IFC4.3 class catalogue (see enum block above)
  ['IFCACTOR', IfcTypeEnum.IfcActor],
  ['IFCACTUATOR', IfcTypeEnum.IfcActuator],
  ['IFCAIRTERMINAL', IfcTypeEnum.IfcAirTerminal],
  ['IFCAIRTERMINALBOX', IfcTypeEnum.IfcAirTerminalBox],
  ['IFCAIRTOAIRHEATRECOVERY', IfcTypeEnum.IfcAirToAirHeatRecovery],
  ['IFCALARM', IfcTypeEnum.IfcAlarm],
  ['IFCALIGNMENTCANT', IfcTypeEnum.IfcAlignmentCant],
  ['IFCALIGNMENTHORIZONTAL', IfcTypeEnum.IfcAlignmentHorizontal],
  ['IFCALIGNMENTSEGMENT', IfcTypeEnum.IfcAlignmentSegment],
  ['IFCALIGNMENTVERTICAL', IfcTypeEnum.IfcAlignmentVertical],
  ['IFCASSET', IfcTypeEnum.IfcAsset],
  ['IFCAUDIOVISUALAPPLIANCE', IfcTypeEnum.IfcAudioVisualAppliance],
  ['IFCBEARING', IfcTypeEnum.IfcBearing],
  ['IFCBOILER', IfcTypeEnum.IfcBoiler],
  ['IFCBOREHOLE', IfcTypeEnum.IfcBorehole],
  ['IFCBUILTELEMENT', IfcTypeEnum.IfcBuiltElement],
  ['IFCBUILTSYSTEM', IfcTypeEnum.IfcBuiltSystem],
  ['IFCBURNER', IfcTypeEnum.IfcBurner],
  ['IFCCABLECARRIERFITTING', IfcTypeEnum.IfcCableCarrierFitting],
  ['IFCCABLEFITTING', IfcTypeEnum.IfcCableFitting],
  ['IFCCAISSONFOUNDATION', IfcTypeEnum.IfcCaissonFoundation],
  ['IFCCHILLER', IfcTypeEnum.IfcChiller],
  ['IFCCOIL', IfcTypeEnum.IfcCoil],
  ['IFCCOMMUNICATIONSAPPLIANCE', IfcTypeEnum.IfcCommunicationsAppliance],
  ['IFCCOMPRESSOR', IfcTypeEnum.IfcCompressor],
  ['IFCCONDENSER', IfcTypeEnum.IfcCondenser],
  ['IFCCONTROL', IfcTypeEnum.IfcControl],
  ['IFCCONTROLLER', IfcTypeEnum.IfcController],
  ['IFCCONVEYORSEGMENT', IfcTypeEnum.IfcConveyorSegment],
  ['IFCCOOLEDBEAM', IfcTypeEnum.IfcCooledBeam],
  ['IFCCOOLINGTOWER', IfcTypeEnum.IfcCoolingTower],
  ['IFCDAMPER', IfcTypeEnum.IfcDamper],
  ['IFCDEEPFOUNDATION', IfcTypeEnum.IfcDeepFoundation],
  ['IFCDISTRIBUTIONBOARD', IfcTypeEnum.IfcDistributionBoard],
  ['IFCDISTRIBUTIONCHAMBERELEMENT', IfcTypeEnum.IfcDistributionChamberElement],
  ['IFCDISTRIBUTIONCIRCUIT', IfcTypeEnum.IfcDistributionCircuit],
  ['IFCDISTRIBUTIONPORT', IfcTypeEnum.IfcDistributionPort],
  ['IFCDUCTFITTING', IfcTypeEnum.IfcDuctFitting],
  ['IFCDUCTSILENCER', IfcTypeEnum.IfcDuctSilencer],
  ['IFCELECTRICAPPLIANCE', IfcTypeEnum.IfcElectricAppliance],
  ['IFCELECTRICDISTRIBUTIONBOARD', IfcTypeEnum.IfcElectricDistributionBoard],
  ['IFCELECTRICFLOWSTORAGEDEVICE', IfcTypeEnum.IfcElectricFlowStorageDevice],
  ['IFCELECTRICFLOWTREATMENTDEVICE', IfcTypeEnum.IfcElectricFlowTreatmentDevice],
  ['IFCELECTRICGENERATOR', IfcTypeEnum.IfcElectricGenerator],
  ['IFCELECTRICMOTOR', IfcTypeEnum.IfcElectricMotor],
  ['IFCELECTRICTIMECONTROL', IfcTypeEnum.IfcElectricTimeControl],
  ['IFCELEMENT', IfcTypeEnum.IfcElement],
  ['IFCELEMENTCOMPONENT', IfcTypeEnum.IfcElementComponent],
  ['IFCENGINE', IfcTypeEnum.IfcEngine],
  ['IFCEVAPORATIVECOOLER', IfcTypeEnum.IfcEvaporativeCooler],
  ['IFCEVAPORATOR', IfcTypeEnum.IfcEvaporator],
  ['IFCEXTERNALSPATIALELEMENT', IfcTypeEnum.IfcExternalSpatialElement],
  ['IFCEXTERNALSPATIALSTRUCTUREELEMENT', IfcTypeEnum.IfcExternalSpatialStructureElement],
  ['IFCFAN', IfcTypeEnum.IfcFan],
  ['IFCFEATUREELEMENT', IfcTypeEnum.IfcFeatureElement],
  ['IFCFEATUREELEMENTADDITION', IfcTypeEnum.IfcFeatureElementAddition],
  ['IFCFEATUREELEMENTSUBTRACTION', IfcTypeEnum.IfcFeatureElementSubtraction],
  ['IFCFILTER', IfcTypeEnum.IfcFilter],
  ['IFCFIRESUPPRESSIONTERMINAL', IfcTypeEnum.IfcFireSuppressionTerminal],
  ['IFCFLOWINSTRUMENT', IfcTypeEnum.IfcFlowInstrument],
  ['IFCFLOWMETER', IfcTypeEnum.IfcFlowMeter],
  ['IFCGEOMODEL', IfcTypeEnum.IfcGeomodel],
  ['IFCGEOSLICE', IfcTypeEnum.IfcGeoslice],
  ['IFCGEOTECHNICALELEMENT', IfcTypeEnum.IfcGeotechnicalElement],
  ['IFCGRID', IfcTypeEnum.IfcGrid],
  ['IFCGROUP', IfcTypeEnum.IfcGroup],
  ['IFCHEATEXCHANGER', IfcTypeEnum.IfcHeatExchanger],
  ['IFCHUMIDIFIER', IfcTypeEnum.IfcHumidifier],
  ['IFCIMPACTPROTECTIONDEVICE', IfcTypeEnum.IfcImpactProtectionDevice],
  ['IFCINTERCEPTOR', IfcTypeEnum.IfcInterceptor],
  ['IFCINVENTORY', IfcTypeEnum.IfcInventory],
  ['IFCJUNCTIONBOX', IfcTypeEnum.IfcJunctionBox],
  ['IFCLAMP', IfcTypeEnum.IfcLamp],
  ['IFCLIGHTFIXTURE', IfcTypeEnum.IfcLightFixture],
  ['IFCLINEARELEMENT', IfcTypeEnum.IfcLinearElement],
  ['IFCLINEARPOSITIONINGELEMENT', IfcTypeEnum.IfcLinearPositioningElement],
  ['IFCLIQUIDTERMINAL', IfcTypeEnum.IfcLiquidTerminal],
  ['IFCMEDICALDEVICE', IfcTypeEnum.IfcMedicalDevice],
  ['IFCMOBILETELECOMMUNICATIONSAPPLIANCE', IfcTypeEnum.IfcMobileTelecommunicationsAppliance],
  ['IFCMOTORCONNECTION', IfcTypeEnum.IfcMotorConnection],
  ['IFCOBJECT', IfcTypeEnum.IfcObject],
  ['IFCOBJECTDEFINITION', IfcTypeEnum.IfcObjectDefinition],
  ['IFCOCCUPANT', IfcTypeEnum.IfcOccupant],
  ['IFCOUTLET', IfcTypeEnum.IfcOutlet],
  ['IFCPIPEFITTING', IfcTypeEnum.IfcPipeFitting],
  ['IFCPORT', IfcTypeEnum.IfcPort],
  ['IFCPROCESS', IfcTypeEnum.IfcProcess],
  ['IFCPRODUCT', IfcTypeEnum.IfcProduct],
  ['IFCPROJECTIONELEMENT', IfcTypeEnum.IfcProjectionElement],
  ['IFCPROTECTIVEDEVICE', IfcTypeEnum.IfcProtectiveDevice],
  ['IFCPROTECTIVEDEVICETRIPPINGUNIT', IfcTypeEnum.IfcProtectiveDeviceTrippingUnit],
  ['IFCPUMP', IfcTypeEnum.IfcPump],
  ['IFCRAIL', IfcTypeEnum.IfcRail],
  ['IFCREINFORCEDSOIL', IfcTypeEnum.IfcReinforcedSoil],
  ['IFCREINFORCINGELEMENT', IfcTypeEnum.IfcReinforcingElement],
  ['IFCRESOURCE', IfcTypeEnum.IfcResource],
  ['IFCROOT', IfcTypeEnum.IfcRoot],
  ['IFCSANITARYTERMINAL', IfcTypeEnum.IfcSanitaryTerminal],
  ['IFCSENSOR', IfcTypeEnum.IfcSensor],
  ['IFCSOLARDEVICE', IfcTypeEnum.IfcSolarDevice],
  ['IFCSPACEHEATER', IfcTypeEnum.IfcSpaceHeater],
  ['IFCSPATIALELEMENT', IfcTypeEnum.IfcSpatialElement],
  ['IFCSPATIALSTRUCTUREELEMENT', IfcTypeEnum.IfcSpatialStructureElement],
  ['IFCSTACKTERMINAL', IfcTypeEnum.IfcStackTerminal],
  ['IFCSTRUCTURALACTION', IfcTypeEnum.IfcStructuralAction],
  ['IFCSTRUCTURALACTIVITY', IfcTypeEnum.IfcStructuralActivity],
  ['IFCSTRUCTURALANALYSISMODEL', IfcTypeEnum.IfcStructuralAnalysisModel],
  ['IFCSTRUCTURALCONNECTION', IfcTypeEnum.IfcStructuralConnection],
  ['IFCSTRUCTURALITEM', IfcTypeEnum.IfcStructuralItem],
  ['IFCSTRUCTURALLOADGROUP', IfcTypeEnum.IfcStructuralLoadGroup],
  ['IFCSTRUCTURALMEMBER', IfcTypeEnum.IfcStructuralMember],
  ['IFCSTRUCTURALREACTION', IfcTypeEnum.IfcStructuralReaction],
  ['IFCSTRUCTURALRESULTGROUP', IfcTypeEnum.IfcStructuralResultGroup],
  ['IFCSURFACEFEATURE', IfcTypeEnum.IfcSurfaceFeature],
  ['IFCSWITCHINGDEVICE', IfcTypeEnum.IfcSwitchingDevice],
  ['IFCSYSTEMFURNITUREELEMENT', IfcTypeEnum.IfcSystemFurnitureElement],
  ['IFCTANK', IfcTypeEnum.IfcTank],
  ['IFCTENDONCONDUIT', IfcTypeEnum.IfcTendonConduit],
  ['IFCTRANSFORMER', IfcTypeEnum.IfcTransformer],
  ['IFCTRANSPORTATIONDEVICE', IfcTypeEnum.IfcTransportationDevice],
  ['IFCTUBEBUNDLE', IfcTypeEnum.IfcTubeBundle],
  ['IFCUNITARYCONTROLELEMENT', IfcTypeEnum.IfcUnitaryControlElement],
  ['IFCUNITARYEQUIPMENT', IfcTypeEnum.IfcUnitaryEquipment],
  ['IFCVALVE', IfcTypeEnum.IfcValve],
  ['IFCVIBRATIONDAMPER', IfcTypeEnum.IfcVibrationDamper],
  ['IFCVIBRATIONISOLATOR', IfcTypeEnum.IfcVibrationIsolator],
  ['IFCVIRTUALELEMENT', IfcTypeEnum.IfcVirtualElement],
  ['IFCVOIDINGFEATURE', IfcTypeEnum.IfcVoidingFeature],
  ['IFCWASTETERMINAL', IfcTypeEnum.IfcWasteTerminal],
  // Spatial
  ['IFCPROJECT', IfcTypeEnum.IfcProject],
  ['IFCSITE', IfcTypeEnum.IfcSite],
  ['IFCBUILDING', IfcTypeEnum.IfcBuilding],
  ['IFCBUILDINGSTOREY', IfcTypeEnum.IfcBuildingStorey],
  ['IFCSPACE', IfcTypeEnum.IfcSpace],
  ['IFCSPATIALZONE', IfcTypeEnum.IfcSpatialZone],
  ['IFCZONE', IfcTypeEnum.IfcZone],
  ['IFCSYSTEM', IfcTypeEnum.IfcSystem],
  ['IFCDISTRIBUTIONSYSTEM', IfcTypeEnum.IfcDistributionSystem],
  ['IFCFACILITY', IfcTypeEnum.IfcFacility],
  ['IFCFACILITYPART', IfcTypeEnum.IfcFacilityPart],
  ['IFCBRIDGE', IfcTypeEnum.IfcBridge],
  ['IFCBRIDGEPART', IfcTypeEnum.IfcBridgePart],
  ['IFCROAD', IfcTypeEnum.IfcRoad],
  ['IFCROADPART', IfcTypeEnum.IfcRoadPart],
  ['IFCRAILWAY', IfcTypeEnum.IfcRailway],
  ['IFCRAILWAYPART', IfcTypeEnum.IfcRailwayPart],
  ['IFCMARINEFACILITY', IfcTypeEnum.IfcMarineFacility],
  ['IFCMARINEPART', IfcTypeEnum.IfcMarinePart],
  ['IFCFACILITYPARTCOMMON', IfcTypeEnum.IfcFacilityPartCommon],
  // Building elements
  ['IFCWALL', IfcTypeEnum.IfcWall],
  ['IFCWALLSTANDARDCASE', IfcTypeEnum.IfcWallStandardCase],
  ['IFCDOOR', IfcTypeEnum.IfcDoor],
  ['IFCDOORSTANDARDCASE', IfcTypeEnum.IfcDoor],
  ['IFCWINDOW', IfcTypeEnum.IfcWindow],
  ['IFCWINDOWSTANDARDCASE', IfcTypeEnum.IfcWindow],
  ['IFCSLAB', IfcTypeEnum.IfcSlab],
  ['IFCSLABSTANDARDCASE', IfcTypeEnum.IfcSlab],
  ['IFCCOLUMN', IfcTypeEnum.IfcColumn],
  ['IFCCOLUMNSTANDARDCASE', IfcTypeEnum.IfcColumn],
  ['IFCBEAM', IfcTypeEnum.IfcBeam],
  ['IFCBEAMSTANDARDCASE', IfcTypeEnum.IfcBeam],
  ['IFCSTAIR', IfcTypeEnum.IfcStair],
  ['IFCSTAIRFLIGHT', IfcTypeEnum.IfcStairFlight],
  ['IFCRAMP', IfcTypeEnum.IfcRamp],
  ['IFCRAMPFLIGHT', IfcTypeEnum.IfcRampFlight],
  ['IFCROOF', IfcTypeEnum.IfcRoof],
  ['IFCCOVERING', IfcTypeEnum.IfcCovering],
  ['IFCCURTAINWALL', IfcTypeEnum.IfcCurtainWall],
  ['IFCRAILING', IfcTypeEnum.IfcRailing],
  ['IFCPILE', IfcTypeEnum.IfcPile],
  ['IFCMEMBER', IfcTypeEnum.IfcMember],
  ['IFCMEMBERSTANDARDCASE', IfcTypeEnum.IfcMember],
  ['IFCPLATE', IfcTypeEnum.IfcPlate],
  ['IFCPLATESTANDARDCASE', IfcTypeEnum.IfcPlate],
  ['IFCFOOTING', IfcTypeEnum.IfcFooting],
  ['IFCBUILDINGELEMENTPROXY', IfcTypeEnum.IfcBuildingElementProxy],
  ['IFCCHIMNEY', IfcTypeEnum.IfcChimney],
  ['IFCSHADINGDEVICE', IfcTypeEnum.IfcShadingDevice],
  ['IFCBUILDINGELEMENTPART', IfcTypeEnum.IfcBuildingElementPart],
  // Openings
  ['IFCOPENINGELEMENT', IfcTypeEnum.IfcOpeningElement],
  ['IFCOPENINGSTANDARDCASE', IfcTypeEnum.IfcOpeningElement],
  // Assemblies and structural
  ['IFCELEMENTASSEMBLY', IfcTypeEnum.IfcElementAssembly],
  ['IFCREINFORCINGBAR', IfcTypeEnum.IfcReinforcingBar],
  ['IFCREINFORCINGMESH', IfcTypeEnum.IfcReinforcingMesh],
  ['IFCTENDON', IfcTypeEnum.IfcTendon],
  ['IFCDISCRETEACCESSORY', IfcTypeEnum.IfcDiscreteAccessory],
  ['IFCMECHANICALFASTENER', IfcTypeEnum.IfcMechanicalFastener],
  // MEP
  ['IFCDISTRIBUTIONELEMENT', IfcTypeEnum.IfcDistributionElement],
  ['IFCDISTRIBUTIONFLOWELEMENT', IfcTypeEnum.IfcDistributionElement],
  ['IFCDISTRIBUTIONCONTROLELEMENT', IfcTypeEnum.IfcDistributionElement],
  ['IFCFLOWTERMINAL', IfcTypeEnum.IfcFlowTerminal],
  ['IFCFLOWSEGMENT', IfcTypeEnum.IfcFlowSegment],
  ['IFCFLOWFITTING', IfcTypeEnum.IfcFlowFitting],
  ['IFCFLOWCONTROLLER', IfcTypeEnum.IfcFlowController],
  ['IFCFLOWMOVINGDEVICE', IfcTypeEnum.IfcFlowMovingDevice],
  ['IFCFLOWSTORAGEDEVICE', IfcTypeEnum.IfcFlowStorageDevice],
  ['IFCFLOWTREATMENTDEVICE', IfcTypeEnum.IfcFlowTreatmentDevice],
  ['IFCENERGYCONVERSIONDEVICE', IfcTypeEnum.IfcEnergyConversionDevice],
  ['IFCDUCTSEGMENT', IfcTypeEnum.IfcDuctSegment],
  ['IFCPIPESEGMENT', IfcTypeEnum.IfcPipeSegment],
  ['IFCCABLESEGMENT', IfcTypeEnum.IfcCableSegment],
  // Furnishing
  ['IFCFURNISHINGELEMENT', IfcTypeEnum.IfcFurnishingElement],
  ['IFCFURNITURE', IfcTypeEnum.IfcFurniture],
  // Other products
  ['IFCPROXY', IfcTypeEnum.IfcProxy],
  ['IFCANNOTATION', IfcTypeEnum.IfcAnnotation],
  ['IFCTRANSPORTELEMENT', IfcTypeEnum.IfcTransportElement],
  ['IFCCIVILELEMENT', IfcTypeEnum.IfcCivilElement],
  ['IFCGEOGRAPHICELEMENT', IfcTypeEnum.IfcGeographicElement],
  // IFC4x3 infrastructure leaves
  ['IFCCOURSE', IfcTypeEnum.IfcCourse],
  ['IFCPAVEMENT', IfcTypeEnum.IfcPavement],
  ['IFCKERB', IfcTypeEnum.IfcKerb],
  ['IFCMOORINGDEVICE', IfcTypeEnum.IfcMooringDevice],
  ['IFCNAVIGATIONELEMENT', IfcTypeEnum.IfcNavigationElement],
  ['IFCTRACKELEMENT', IfcTypeEnum.IfcTrackElement],
  ['IFCVEHICLE', IfcTypeEnum.IfcVehicle],
  ['IFCEARTHWORKSELEMENT', IfcTypeEnum.IfcEarthworksElement],
  ['IFCEARTHWORKSFILL', IfcTypeEnum.IfcEarthworksFill],
  ['IFCEARTHWORKSCUT', IfcTypeEnum.IfcEarthworksCut],
  ['IFCREFERENT', IfcTypeEnum.IfcReferent],
  ['IFCSIGN', IfcTypeEnum.IfcSign],
  ['IFCSIGNAL', IfcTypeEnum.IfcSignal],
  ['IFCGEOTECHNICALSTRATUM', IfcTypeEnum.IfcGeotechnicalStratum],
  ['IFCGEOTECHNICALASSEMBLY', IfcTypeEnum.IfcGeotechnicalAssembly],
  ['IFCSOLIDSTRATUM', IfcTypeEnum.IfcSolidStratum],
  ['IFCVOIDSTRATUM', IfcTypeEnum.IfcVoidStratum],
  ['IFCWATERSTRATUM', IfcTypeEnum.IfcWaterStratum],
  ['IFCPOSITIONINGELEMENT', IfcTypeEnum.IfcPositioningElement],
  ['IFCALIGNMENT', IfcTypeEnum.IfcAlignment],
  // Relationships
  ['IFCRELCONTAINEDINSPATIALSTRUCTURE', IfcTypeEnum.IfcRelContainedInSpatialStructure],
  ['IFCRELAGGREGATES', IfcTypeEnum.IfcRelAggregates],
  ['IFCRELDEFINESBYPROPERTIES', IfcTypeEnum.IfcRelDefinesByProperties],
  ['IFCRELDEFINESBYTYPE', IfcTypeEnum.IfcRelDefinesByType],
  ['IFCRELASSOCIATESMATERIAL', IfcTypeEnum.IfcRelAssociatesMaterial],
  ['IFCRELASSOCIATESCLASSIFICATION', IfcTypeEnum.IfcRelAssociatesClassification],
  ['IFCRELVOIDSELEMENT', IfcTypeEnum.IfcRelVoidsElement],
  ['IFCRELFILLSELEMENT', IfcTypeEnum.IfcRelFillsElement],
  ['IFCRELCONNECTSPATHELEMENTS', IfcTypeEnum.IfcRelConnectsPathElements],
  ['IFCRELSPACEBOUNDARY', IfcTypeEnum.IfcRelSpaceBoundary],
  // Properties
  ['IFCPROPERTYSET', IfcTypeEnum.IfcPropertySet],
  ['IFCPROPERTYSINGLEVALUE', IfcTypeEnum.IfcPropertySingleValue],
  ['IFCPROPERTYENUMERATEDVALUE', IfcTypeEnum.IfcPropertyEnumeratedValue],
  ['IFCPROPERTYBOUNDEDVALUE', IfcTypeEnum.IfcPropertyBoundedValue],
  ['IFCPROPERTYLISTVALUE', IfcTypeEnum.IfcPropertyListValue],
  ['IFCELEMENTQUANTITY', IfcTypeEnum.IfcElementQuantity],
  ['IFCQUANTITYLENGTH', IfcTypeEnum.IfcQuantityLength],
  ['IFCQUANTITYAREA', IfcTypeEnum.IfcQuantityArea],
  ['IFCQUANTITYVOLUME', IfcTypeEnum.IfcQuantityVolume],
  ['IFCQUANTITYCOUNT', IfcTypeEnum.IfcQuantityCount],
  ['IFCQUANTITYWEIGHT', IfcTypeEnum.IfcQuantityWeight],
  // Type definitions
  ['IFCWALLTYPE', IfcTypeEnum.IfcWallType],
  ['IFCDOORTYPE', IfcTypeEnum.IfcDoorType],
  ['IFCWINDOWTYPE', IfcTypeEnum.IfcWindowType],
  ['IFCSLABTYPE', IfcTypeEnum.IfcSlabType],
  ['IFCCOLUMNTYPE', IfcTypeEnum.IfcColumnType],
  ['IFCBEAMTYPE', IfcTypeEnum.IfcBeamType],
  ['IFCPILETYPE', IfcTypeEnum.IfcPileType],
  ['IFCMEMBERTYPE', IfcTypeEnum.IfcMemberType],
  ['IFCPLATETYPE', IfcTypeEnum.IfcPlateType],
  ['IFCFOOTINGTYPE', IfcTypeEnum.IfcFootingType],
  ['IFCCOVERINGTYPE', IfcTypeEnum.IfcCoveringType],
  ['IFCRAILINGTYPE', IfcTypeEnum.IfcRailingType],
  ['IFCSTAIRTYPE', IfcTypeEnum.IfcStairType],
  ['IFCRAMPTYPE', IfcTypeEnum.IfcRampType],
  ['IFCROOFTYPE', IfcTypeEnum.IfcRoofType],
  ['IFCCURTAINWALLTYPE', IfcTypeEnum.IfcCurtainWallType],
  ['IFCBUILDINGELEMENTPROXYTYPE', IfcTypeEnum.IfcBuildingElementProxyType],
]);


export function IfcTypeEnumFromString(str: string): IfcTypeEnum {
  return TYPE_STRING_TO_ENUM.get(str.toUpperCase()) ?? IfcTypeEnum.Unknown;
}

export function IfcTypeEnumToString(type: IfcTypeEnum): string {
  // TypeScript's reverse mapping on a numeric enum: `IfcTypeEnum[67]` is the
  // MEMBER NAME, 'IfcMarineFacility'. Every member name in this enum already
  // spells the IFC class exactly, so a hand-written enum->string table would
  // be a second copy of the member list with nothing keeping the two in step
  // — the drift that puts a class in one direction and not the other. An id
  // no member holds reverse-maps to undefined, which is the same 'Unknown'
  // the table's `.get()` miss produced.
  return IfcTypeEnum[type] ?? 'Unknown';
}

/**
 * IFC STEP attribute value as extracted from a STEP argument list.
 *
 * WRITE-ONLY markers (never produced by extraction) let authoring code
 * pin the exact STEP token for a value whose type a bare JS primitive cannot
 * convey:
 *
 * - `{ literal: string }` (from `stepString`) writes quoted literal text even
 *   when it equals `$`, `*`, a reference or an enumeration (#9876).
 *
 * - `{ real: number }` forces a STEP REAL literal with a decimal point for
 *   whole numbers (`5.` not `5`), which typed measures like `IfcLengthMeasure`
 *   require. Plain `number` keeps the historical integer-when-whole behavior.
 *
 * - `{ typed: { type, value } }` forces a type-QUALIFIED value
 *   `IFC<TYPE>(<value>)` — required for a SELECT member that is a defined type
 *   (`IFCBOOLEAN(.T.)` in an `IfcTranslationalStiffnessSelect` slot) and for the
 *   `IfcValue` family (`IFCLABEL('x')`, `IFCLENGTHMEASURE(3.)`). `type` is the
 *   IFC type name (`'IfcBoolean'`, `'IfcLengthMeasure'`). It generalizes
 *   `{ real }` (`{ typed: { type: 'IfcReal', value: 450 } }`). The exporter also
 *   auto-qualifies unambiguous SELECT slots without a marker; this is the escape
 *   hatch for the ambiguous ones (a select with several REAL-backed members).
 */
export type IfcAttributeValue =
  | string
  | number
  | boolean
  | null
  | { real: number }
  | { literal: string }
  | { typed: { type: string; value: string | number | boolean | number[] } }
  | IfcAttributeValue[];

export interface IfcEntity {
  expressId: number;
  type: string;
  attributes: IfcAttributeValue[];
  /**
   * STEP token-kind side channel (#1799): indices into `attributes` whose
   * TOP-LEVEL source token was a bare enumeration (`.USERDEFINED.` — dotted in
   * the source, unquoted). The value representation is unchanged (an enum is
   * still stored as its dotted string), so existing consumers are unaffected;
   * this channel only records the token KIND, letting consumers distinguish a
   * bare enum from a quoted string that happens to look like one
   * (`'.USERDEFINED.'`) — mirroring the Rust parser's separate
   * `AttributeValue::String` / `AttributeValue::Enum` variants.
   *
   * Optional: absent when the entity has no bare-enum attributes, or when the
   * producer predates / does not track token kinds (hand-built entities,
   * mutation authoring). Nested tokens (inside lists or typed values) are not
   * tracked. Indices are in ascending order.
   */
  enumAttrIndices?: readonly number[];
}
