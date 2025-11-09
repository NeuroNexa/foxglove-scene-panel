import { Matrix4, Quaternion, Vector3 } from "three";

import type { FramePose } from "./sceneTypes";

type TransformStamped = {
  header?: { frame_id?: string };
  child_frame_id?: string;
  transform?: {
    translation?: { x?: number; y?: number; z?: number };
    rotation?: { x?: number; y?: number; z?: number; w?: number };
  };
};

type TfMessage = {
  transforms?: TransformStamped[];
};

type FrameTransform = {
  parent: string | undefined;
  matrix: Matrix4;
};

const IDENTITY = new Matrix4();

export class TfStore {
  private dynamicTransforms = new Map<string, FrameTransform>();

  private staticTransforms = new Map<string, FrameTransform>();

  update(message: TfMessage, isStatic: boolean): boolean {
    const store = isStatic ? this.staticTransforms : this.dynamicTransforms;
    let updated = false;

    for (const transform of message.transforms ?? []) {
      const child = normalizeFrame(transform.child_frame_id);
      if (!child) {
        continue;
      }
      const parent = normalizeFrame(transform.header?.frame_id);
      const matrix = composeMatrix(transform);
      const previous = store.get(child);
      if (!previous || parent !== previous.parent || matricesDiffer(previous.matrix, matrix)) {
        store.set(child, { parent, matrix });
        updated = true;
      }
    }

    return updated;
  }

  resetDynamic(): void {
    this.dynamicTransforms.clear();
  }

  clearAll(): void {
    this.dynamicTransforms.clear();
    this.staticTransforms.clear();
  }

  listFrames(extra: string[] = []): string[] {
    const frames = new Set<string>();
    for (const [child, value] of this.dynamicTransforms) {
      frames.add(child);
      if (value.parent) {
        frames.add(value.parent);
      }
    }

    for (const [child, value] of this.staticTransforms) {
      frames.add(child);
      if (value.parent) {
        frames.add(value.parent);
      }
    }

    for (const name of extra) {
      if (name) {
        frames.add(name);
      }
    }

    return Array.from(frames).filter(Boolean).sort();
  }

  buildPoseData(fixedFrame?: string): { frames: FramePose[]; matrixMap: Map<string, Matrix4> } {
    const frameNames = new Set<string>();
    for (const name of this.dynamicTransforms.keys()) {
      frameNames.add(name);
    }
    for (const name of this.staticTransforms.keys()) {
      frameNames.add(name);
    }
    for (const transform of this.dynamicTransforms.values()) {
      if (transform.parent) {
        frameNames.add(transform.parent);
      }
    }
    for (const transform of this.staticTransforms.values()) {
      if (transform.parent) {
        frameNames.add(transform.parent);
      }
    }
    if (fixedFrame) {
      frameNames.add(fixedFrame);
    }

    const worldCache = new Map<string, Matrix4>();
    const matrixMap = new Map<string, Matrix4>();
    const frames: FramePose[] = [];

    const fixedWorld = fixedFrame ? this.resolveWorldMatrix(fixedFrame, worldCache, new Set()) ?? IDENTITY : IDENTITY;
    const fixedInverse = fixedWorld.clone().invert();

    frameNames.forEach((frameName) => {
      if (!frameName) {
        return;
      }
      const world = this.resolveWorldMatrix(frameName, worldCache, new Set()) ?? IDENTITY;
      const relative = fixedFrame ? fixedInverse.clone().multiply(world) : world.clone();
      matrixMap.set(frameName, relative);
      frames.push({ frameId: frameName, matrix: relative });
    });

    return { frames, matrixMap };
  }

  private resolveWorldMatrix(
    frame: string,
    cache: Map<string, Matrix4>,
    stack: Set<string>,
  ): Matrix4 | undefined {
    if (cache.has(frame)) {
      return cache.get(frame);
    }
    if (stack.has(frame)) {
      return IDENTITY;
    }

    const transform = this.dynamicTransforms.get(frame) ?? this.staticTransforms.get(frame);
    if (!transform) {
      cache.set(frame, IDENTITY.clone());
      return cache.get(frame);
    }

    stack.add(frame);
    const parentMatrix =
      transform.parent && transform.parent !== frame
        ? this.resolveWorldMatrix(transform.parent, cache, stack) ?? IDENTITY
        : IDENTITY;
    stack.delete(frame);

    const worldMatrix = parentMatrix.clone().multiply(transform.matrix);
    cache.set(frame, worldMatrix);
    return worldMatrix;
  }
}

function normalizeFrame(frame?: string): string | undefined {
  if (!frame) {
    return undefined;
  }
  return frame.startsWith("/") ? frame.slice(1) : frame;
}

function composeMatrix(transform: TransformStamped): Matrix4 {
  const translation = new Vector3(
    transform.transform?.translation?.x ?? 0,
    transform.transform?.translation?.y ?? 0,
    transform.transform?.translation?.z ?? 0,
  );
  const rotation = new Quaternion(
    transform.transform?.rotation?.x ?? 0,
    transform.transform?.rotation?.y ?? 0,
    transform.transform?.rotation?.z ?? 0,
    transform.transform?.rotation?.w ?? 1,
  ).normalize();

  const matrix = new Matrix4();
  matrix.compose(translation, rotation, new Vector3(1, 1, 1));
  return matrix;
}

function matricesDiffer(a: Matrix4, b: Matrix4): boolean {
  const ae = a.elements;
  const be = b.elements;
  for (let i = 0; i < 16; i += 1) {
    if (ae[i] !== be[i]) {
      return true;
    }
  }
  return false;
}
