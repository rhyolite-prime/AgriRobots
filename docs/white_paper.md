# White Paper: Autonomous Modular Agricultural Robotics System (AMARS)

**Title:** Next-Generation Modular Agricultural AGVs Driven by Web-Based Virtual Labs, Reinforcement Learning, and DSL Runtimes  
**Document Version:** 1.0  
**Target Architecture:** Nuxt.js 4.x Virtual Lab $\rightarrow$ AI / Simulation Engine $\rightarrow$ DSL Execution Runtime $\rightarrow$ Modular Hardware Chassis  

---

## Executive Summary

The Agricultural Robotics Industry currently suffers from fragmented, single-purpose hardware design. Building bespoke platforms for egg harvesting, feeding, barn sanitization, and selective micro-weeding leads to high deployment costs, long development cycles, and complex maintenance logistics.

The **Autonomous Modular Agricultural Robotics System (AMARS)** resolves this paradigm through four core innovations:
1. **Unified Modular Base Platform:** A standardized ground vehicle featuring a high-current, high-bandwidth Unified Tool Connector (UTC) slot for task-specific payloads.
2. **Nuxt.js 4.x Web-Based Virtual Lab:** A digital twin environment allowing multi-disciplinary engineering teams to visually assemble component CAD models, design electronic schematics, simulate CAN/Ethernet inter-service messaging, and configure hardware callbacks in the browser.
3. **Sim-to-Real AI Training:** Synthetic computer vision generation and reinforcement learning (RL) policies trained in digital twin environments to master complex spatial tasks (e.g., egg retrieval in cluttered nests or young seedling identification).
4. **DSL Script Compiler & Swarm Deployment:** Automated translation of trained behaviors, state machine rules, and kinematic paths into a deterministic domain-specific language (AgriDSL / Sapo-style DSL). The compiled payload is distributed over-the-air (OTA) to edge execution engines on individual units or synchronized robot swarms.

---

## 1. System Architecture Overview

The system operates across three primary planes: the **Virtual Lab Engineering Plane**, the **Compilation & Training Pipeline**, and the **Edge Execution Architecture**.

```
+-----------------------------------------------------------------------------------+
|                        NUXT.JS 4.X VIRTUAL LAB PLATFORM                           |
|  +-----------------------+  +------------------------+  +----------------------+  |
|  | Visual CAD Assembly   |  | Schematic & Circuit    |  | Event, Sensor & CAN  |  |
|  | (Three.js / WebGL)    |  | Designer (Wokwi Core)  |  | Callback Inspector   |  |
|  +-----------------------+  +------------------------+  +----------------------+  |
+-----------------------------------------------------------------------------------+
                                         │ Export Digital Twin Spec / URDF
                                         ▼
+-----------------------------------------------------------------------------------+
|                           AI TRAINING & SIMULATION PIPELINE                       |
|  +-----------------------------------------------------------------------------+  |
|  | Synthetic Data Engine (Omniverse / Isaac Sim / Gazebo Web Assembly)        |  |
|  | Computer Vision Training (YOLOv8 Segmentation) & RL Motor Policies (PPO/SAC)|  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
                                         │ Compile Trained Policy & Behavior Tree
                                         ▼
+-----------------------------------------------------------------------------------+
|                             AGRIDSL SCRIPT GENERATOR                              |
|  +-----------------------------------------------------------------------------+  |
|  | Outputs Human-Readable & Deterministic Bytecode Executable (.ags)            |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
                                         │ OTA Fleet Broadcast
                     ┌───────────────────┼───────────────────┐
                     ▼                   ▼                   ▼
           +-------------------+ +-------------------+ +-------------------+
           | Physical AGV #1   | | Physical AGV #2   | | Physical AGV #N   |
           | Edge DSL Engine   | | Edge DSL Engine   | | Edge DSL Engine   |
           +-------------------+ +-------------------+ +-------------------+
```

---

## 2. Web-Based Virtual Lab (Nuxt.js 4.x Architecture)

The Virtual Lab acts as the single source of truth for hardware design, software binding, circuit layout, and behavior prototyping before physical fabrication.

### Tech Stack Specifications
* **Frontend Framework:** Nuxt.js 4.x (SSR/SSG hybrid with Vue 3 Composition API & Nitro engine).
* **3D Canvas & Assembly Engine:** Three.js / WebGPU renderer via `@tresjs/core` for real-time physics and joint constraint assembly.
* **Circuit & Embedded Simulation Engine:** Custom WebAssembly bindings for Spice/Wokwi embedded cores to simulate microcontrollers (ESP32/STM32) and sensor I/O signals.
* **Inter-Component Bus Visualizer:** Real-time event bus emulator built on WebSockets/WebRTC to stream dynamic JSON-CAN frames and inspect callback executions.

```
/virtual-lab-app
├── server/
│   └── api/
│       ├── compile-dsl.post.ts     # Compiles visual nodes into AgriDSL script
│       └── sim-session.ws.ts       # WebSockets gateway for multi-agent state sync
├── components/
│   ├── studio/
│   │   ├── AssemblyCanvas.vue      # 3D drag-and-drop CAD/URDF builder
│   │   ├── CircuitDesigner.vue     # Schematics, pin mappings & bus interlocks
│   │   └── EventInspector.vue      # Live callback log & event trigger editor
│   └── modules/
│       ├── UTCBaySlot.vue          # Unified Tool Connector interface mapping
│       └── ModuleRegistry.vue      # Swappable payload inventory library
└── engine/
    ├── kinematics/                 # WebAssembly inverse kinematics solver
    └── dsl-compiler/               # AST parsing and bytecode builder
```

### Key Capabilities of the Virtual Lab

1. **Modular Drag-and-Drop Mechanical Docking:** Engineers load 3D GLTF/URDF assets into the canvas. Docking snap-points enforce mechanical pin tolerances and Unified Tool Connector alignment.
2. **Circuit Design & Electrical Interlocks:** Design PCB connection topologies, voltage steps (24V motor lines down to 5V/3.3V logic), and pin assignments for CAN-FD, SPI, and Ethernet lines.
3. **Event Callback Design Interface:** A node-based behavioral graph builder allowing engineers to map hardware events to code handlers:
   * *Example:* `ON event:tray_full(capacity >= 100) -> CALL action:trigger_sanitization_cycle()`.

---

## 3. Sim-to-Real AI Training Framework

Before physical testing, robot controllers undergo spatial perception and motor movement training inside synthetic virtual environments.

### Task-Specific Example: Egg Detection, Isolation & Picking
1. **Synthetic Image Generation:** The Virtual Lab exports the digital twin model into Omniverse / Isaac Sim to generate 50,000 synthetic photorealistic images of poultry nest boxes under varying lighting, egg sizes, dirt patterns, straw obstructions, and bird movements.
2. **Perception Training:** Fine-tuning segmentation models (YOLOv8-seg / TensorRT) to identify egg centroids, orientation vectors, and surface integrity under heavy occlusions.
3. **Reinforcement Learning (RL) Policy Training:** 
   * **State Space:** Soft-gripper pose, eye-in-hand RGB-D depth frame, tactile sensor pressure feedback.
   * **Action Space:** 4-DOF manipulator joint velocities and vacuum gripper activation.
   * **Reward Function:**
     $$\mathcal{R} = +100 \cdot \mathbb{I}_{\text{success}} - 50 \cdot \mathbb{I}_{\text{crushed}} - 10 \cdot \mathbb{I}_{\text{collision}} - \alpha \cdot \text{time\_elapsed}$$
4. **Safety Verification:** The policy is tested against thousands of edge cases (e.g., live hen resisting extraction, cracked shell resistance) inside the Virtual Lab before being wrapped into an executable action block.

---

## 4. AgriDSL Execution Engine & Swarm Behavior

All verified behaviors, kinematics policies, and callback graphs created in the Nuxt Virtual Lab are compiled into a deterministic, human-readable DSL file (**AgriDSL**).

### AgriDSL Syntax & Runtime Model

```json
SYSTEM_MANIFEST {
    CHASSIS_ID: "AMARS-AGV-V2",
    REQUIRED_MODULE: "MOD_EGG_PICKER_VAC_01",
    COMMUNICATION_BUS: "CAN-FD_1MBPS"
}

BEHAVIOR_GRAPH EggHarvestingRoutine {
    EVENT_HANDLERS {
        ON_EVENT("ULTRASONIC_OBSTACLE_DETECTED", DISTANCE < 0.35) {
            EXECUTE_COMMAND("HALT_BASE_MOTORS", BRAKE_FORCE=0.8);
            RAISE_SIGNAL("HAZARD_LIGHTS_ON");
        }
        
        ON_EVENT("EGG_TRAY_FULL", CAPACITY_COUNT >= 120) {
            EXECUTE_COMMAND("RETRACT_ARM_TO_STOW_POSE");
            NAVIGATE_TO_WAYPOINT("STATION_COLLECTION_POINT");
        }
    }

    SEQUENCE_BLOCK {
        SET_DRIVE_SPEED(0.3); // m/s
        
        WHILE_WAYPOINT_PATH_ACTIVE("POULTRY_BAY_ROW_3") {
            TRIGGER_PERCEPTION_NODE("EGG_DETECTOR_MODEL_V4");
            
            IF_TARGET_ACQUIRED("EGG", CONFIDENCE > 0.88) {
                PAUSE_DRIVE_PATH();
                
                // Trained Reinforcement Learning Trajectory
                EXECUTE_AI_POLICY(
                    POLICY_ID="POLICY_EGG_SOFT_PICK_V2",
                    MAX_FORCE_NEWTONS=1.8,
                    TIMEOUT_SEC=12.0
                );
                
                PULSE_OUTPUT("UVC_SANITIZER_STRIP", DURATION_MS=1500);
                INCREMENT_COUNTER("HARVESTED_EGGS");
                RESUME_DRIVE_PATH();
            }
        }
    }
}
```

### Swarm & Multi-Device Deployment Model
Because AgriDSL is hardware-decoupled and execution runs locally on an onboard C++ runtime engine (built using Drogon/C++23 state-machine logic), the exact same compiled behavior script can be broadcast OTA to a group of 20 AGVs:
* **Leader-Follower Orchestrator:** One master node assigns spatial sub-regions using lightweight MQTT/ZeroMQ inter-agent heartbeat signals.
* **Autonomous Task Redistribution:** If AGV #3 detects a full egg tray, it publishes a task handover message. AGV #4 dynamically adopts the script execution sequence at the exact waypoint coordinate.

---

## 5. Hardware Modular Specifications

The physical vehicle implements strict mechanical, electrical, and data interface specifications derived from the Virtual Lab schemas.

```
            TOP-DOWN SCHEMATIC: BASE CHASSIS & UTILITY BAY
+-----------------------------------------------------------------+
| [Rear Caster]                                     [Rear Caster] |
|                                                                 |
|         +---------------------------------------------+         |
|         |           HOT-SWAPPABLE PAYLOAD BAY         |         |
|         |               (600mm x 450mm)               |         |
|         |                                             |         |
|         |   [UTC DOCKING HUB]                         |         |
|         |   - 24V/30A Power   - Dual CAN-FD             |         |
|         |   - 12V Logic       - 1Gbps Ethernet        |         |
|         +---------------------------------------------+         |
|                                                                 |
| [Drive Wheel L]  <===== 350W Hub Motors =====>  [Drive Wheel R] |
+-----------------------------------------------------------------+
```

### Chassis Mechanical Dimensions
* **External Envelope:** $1000\text{ mm (L)} \times 650\text{ mm (W)} \times 450\text{ mm (H)}$
* **Tool Slot Dimensions:** $600\text{ mm (L)} \times 450\text{ mm (W)} \times 350\text{ mm (H)}$
* **Base Frame:** T-slot $4040$ structural anodized aluminum profile with modular corner gussets.
* **Ingress Protection:** Base drive electronics enclosed to IP65; tool slot connectors feature self-sealing rubber gaskets.

### Unified Tool Connector (UTC) Pinout

| Pin Group | Signal / Type | Specification |
| :--- | :--- | :--- |
| **P1 - P2** | $24\text{V DC Power Bus}$ | Up to $30\text{A}$ continuous load for pumps, augers, and arm motors. |
| **P3 - P4** | $12\text{V DC Logic}$ | Regulated supply for microcontrollers and edge perception sensors. |
| **C1 - C2** | $\text{CAN Bus 1 (Control)}$ | $1\text{ Mbps CAN-FD}$ frame bus for motor control and telemetry commands. |
| **C3 - C4** | $\text{CAN Bus 2 (Safety)}$ | Dedicated safety interlock bus (Emergency Stop, Limit switches). |
| **E1 - E4** | $\text{Gigabit Ethernet}$ | $1000\text{BASE-T}$ 4-wire differential pairs for high-res camera video streaming. |
| **A1 - A2** | $\text{Auto-ID Bus}$ | One-Wire EEPROM read lines to query payload ID, serial number, and JSON spec. |

---

## 6. Implementation Roadmap

```
Phase 1: Virtual Lab Core (Months 1-2)
└── Nuxt 4.x shell, Three.js canvas, and WebAssembly DSL compiler.

Phase 2: Sim-to-Real AI Pipeline (Months 3-4)
└── Omniverse/Isaac Sim data synthesis, YOLOv8 segmentation, and RL motor policy training.

Phase 3: Hardware & Execution Engine (Months 5-6)
└── Physical chassis assembly, UTC bus design, and C++ AgriDSL runtime integration.

Phase 4: Fleet Deployment & Field Trials (Months 7-8)
└── Wireless OTA DSL dispatch, multi-agent swarm coordination, and field validation.
```

---
*End of White Paper Document*