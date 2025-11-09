/* eslint-disable @typescript-eslint/no-bitwise */
export type ParsedPointCloud = {
  id: string;
  frameId: string;
  positions: Float32Array;
  colors?: Float32Array;
};

type PointField = {
  name: string;
  offset: number;
  datatype: number;
  count: number;
};

type PointCloud2Message = {
  header?: { frame_id?: string };
  height: number;
  width: number;
  fields: PointField[];
  is_bigendian?: boolean;
  point_step: number;
  row_step: number;
  data?: Uint8Array | number[];
};

const enum PointFieldType {
  INT8 = 1,
  UINT8 = 2,
  INT16 = 3,
  UINT16 = 4,
  INT32 = 5,
  UINT32 = 6,
  FLOAT32 = 7,
  FLOAT64 = 8,
}

const DEFAULT_FRAME = "map";
const DEFAULT_COLOR: [number, number, number] = [0.2, 0.6, 1];

export function parsePointCloud2(topic: string, message: PointCloud2Message): ParsedPointCloud | undefined {
  const width = Number(message.width) || 0;
  const height = Number(message.height) || 0;
  const totalPoints = width * height;
  if (totalPoints <= 0 || !message.data) {
    return undefined;
  }

  const pointCount = totalPoints;
  const bytes = message.data instanceof Uint8Array ? message.data : Uint8Array.from(message.data);
  if (bytes.byteLength < message.point_step * pointCount) {
    return undefined;
  }

  const xField = message.fields.find((field) => field.name === "x");
  const yField = message.fields.find((field) => field.name === "y");
  const zField = message.fields.find((field) => field.name === "z");

  if (!xField || !yField || !zField) {
    return undefined;
  }

  const colorField = message.fields.find(
    (field) => field.name === "rgb" || field.name === "rgba" || field.name === "intensity",
  );

  const positions = new Float32Array(pointCount * 3);
  const colors = colorField ? new Float32Array(pointCount * 3) : undefined;

  const step = message.point_step;
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const littleEndian = message.is_bigendian ? false : true;

  let validPoints = 0;

  for (let i = 0; i < pointCount; i += 1) {
    const base = i * step;
    const x = readNumeric(dataView, base + xField.offset, xField.datatype, littleEndian);
    const y = readNumeric(dataView, base + yField.offset, yField.datatype, littleEndian);
    const z = readNumeric(dataView, base + zField.offset, zField.datatype, littleEndian);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    positions[validPoints * 3] = x;
    positions[validPoints * 3 + 1] = y;
    positions[validPoints * 3 + 2] = z;

    if (colors && colorField) {
      const [r, g, b] = readColor(dataView, base + colorField.offset, colorField.datatype, littleEndian);
      colors[validPoints * 3] = r;
      colors[validPoints * 3 + 1] = g;
      colors[validPoints * 3 + 2] = b;
    }

    validPoints += 1;
  }

  if (validPoints === 0) {
    return undefined;
  }

  const trimmedPositions = validPoints * 3 === positions.length ? positions : positions.slice(0, validPoints * 3);
  const trimmedColors =
    colors && validPoints * 3 !== colors.length ? colors.slice(0, validPoints * 3) : colors ?? undefined;

  return {
    id: topic,
    frameId: normalizeFrame(message.header?.frame_id) ?? DEFAULT_FRAME,
    positions: trimmedPositions,
    colors: trimmedColors,
  };
}

function readNumeric(view: DataView, offset: number, datatype: number, littleEndian: boolean): number {
  switch (datatype) {
    case PointFieldType.FLOAT32:
      return view.getFloat32(offset, littleEndian);
    case PointFieldType.FLOAT64:
      return view.getFloat64(offset, littleEndian);
    case PointFieldType.UINT8:
      return view.getUint8(offset);
    case PointFieldType.INT8:
      return view.getInt8(offset);
    case PointFieldType.UINT16:
      return view.getUint16(offset, littleEndian);
    case PointFieldType.INT16:
      return view.getInt16(offset, littleEndian);
    case PointFieldType.UINT32:
      return view.getUint32(offset, littleEndian);
    case PointFieldType.INT32:
      return view.getInt32(offset, littleEndian);
    default:
      return NaN;
  }
}

function readColor(view: DataView, offset: number, datatype: number, littleEndian: boolean): [number, number, number] {
  if (datatype === PointFieldType.FLOAT32 || datatype === PointFieldType.UINT32 || datatype === PointFieldType.INT32) {
    const value = view.getUint32(offset, littleEndian);
    return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
  }

  if (datatype === PointFieldType.UINT8 || datatype === PointFieldType.INT8) {
    const intensity = view.getUint8(offset) / 255;
    return [intensity, intensity, intensity];
  }

  if (datatype === PointFieldType.FLOAT64) {
    const intensity = view.getFloat64(offset, littleEndian);
    const normalized = Math.max(0, Math.min(1, intensity));
    return [normalized, normalized, normalized];
  }

  return DEFAULT_COLOR;
}

function normalizeFrame(frame?: string): string | undefined {
  if (!frame) {
    return undefined;
  }
  return frame.startsWith("/") ? frame.slice(1) : frame;
}
