import { Matrix4 } from "three";

export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type PointCloudRenderable = {
  id: string;
  frameId: string;
  positions: Float32Array;
  colors?: Float32Array;
  matrix: Matrix4;
};

export type FramePose = {
  frameId: string;
  matrix: Matrix4;
};
