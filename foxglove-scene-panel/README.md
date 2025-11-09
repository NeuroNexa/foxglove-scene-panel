# foxglove-scene-panel

[Foxglove](https://foxglove.dev) allows developers to create [extensions](https://docs.foxglove.dev/docs/visualization/extensions/introduction), or custom code that is loaded and executed inside the Foxglove application. This can be used to add custom panels. Extensions are authored in TypeScript using the `@foxglove/extension` SDK.

## Develop

Extension development uses the `npm` package manager to install development dependencies and run build scripts.

To install extension dependencies, run `npm` from the root of the extension package.

```sh
npm install
```

To build and install the extension into your local Foxglove desktop app, run:

```sh
npm run local-install
```

Open the Foxglove desktop (or `ctrl-R` to refresh if it is already open). Your extension is installed and available within the app.

## 使用说明（scene-panel）

1. **添加面板**：在 Foxglove Studio 左上角的面板库中选择 `foxglove-scene-panel.scene-panel` 加入布局。
2. **设置数据源**：点击面板右上角齿轮 → 左侧「三维面板」页签，依次配置：
   - 点云主题（支持多选 `sensor_msgs/PointCloud2`）；
   - TF 流 / 静态 TF 话题；
   - 固定坐标系；
   - 交互发布主题（3D Pose Estimate / 3D Pose Goal / 2D Point）。
3. **查看图层**：面板会自动渲染点云、TF 轴以及固定坐标系，拖拽操作：
   - 左键：平移视角；右键：围绕目标旋转；滚轮/中键：缩放。
4. **3D Pose 交互**：
   - 从右侧工具条选择 `3D Pose Estimate`（或 `3D Pose Goal`）。
   - 第一次左键单击：在当前工作平面锁定起点，并弹出粉色预览箭头与高度 Gizmo。
   - **高度调整**：拖动 Gizmo 的圆球即可沿 Z 轴抬升/降低，预览箭头与发布高度实时更新；拖拽期间相机不会缩放。
   - 鼠标移动：控制箭头朝向；第二次左键单击确认方向并发布 `geometry_msgs/PoseStamped`。
5. **3D Pose Estimate 与 Goal 的区别**：Estimate 发布 `PoseWithCovarianceStamped`，Goal 发布 `PoseStamped`，两者流程一致，只是注入话题不同。
6. **3D Point 交互**：选择 `2D Point`（仍旧平面点）后单击即可在工作平面发布点位。
7. **高度范围**：默认限制在 `[-10m, 60m]`。需要更大范围可在 `ThreeScene.tsx` 中调整 `HEIGHT_MIN/HEIGHT_MAX`。

> 提示：切换交互模式或完成发布后，预览箭头和高度 Gizmo 会自动隐藏；如需取消当前操作，重新选择其它工具即可。

## Package

Extensions are packaged into `.foxe` files. These files contain the metadata (package.json) and the build code for the extension.

Before packaging, make sure to set `name`, `publisher`, `version`, and `description` fields in _package.json_. When ready to distribute the extension, run:

```sh
npm run package
```

This command will package the extension into a `.foxe` file in the local directory.

## Publish

You can publish the extension to the public registry or privately for your organization.

See documentation here: https://docs.foxglove.dev/docs/visualization/extensions/publish/#packaging-your-extension
