import * as THREE from 'three';
import { TransportMode } from '../types';

export interface Vehicle3DInstance {
  group: THREE.Group;
  updateAnimation: (delta: number, speed: number, turningAngle: number, isMoving: boolean) => void;
  dispose: () => void;
  type: TransportMode;
}

// Particle manager for contrails, wake, smoke, dust
export class VehicleParticleSystem {
  group: THREE.Group;
  private particles: {
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    life: number;
    maxLife: number;
    initialScale: number;
  }[] = [];
  private pool: THREE.Mesh[] = [];
  private material: THREE.MeshBasicMaterial;
  private geometry: THREE.BufferGeometry;

  constructor(color: number = 0xffffff, opacity: number = 0.5, size: number = 3) {
    this.group = new THREE.Group();
    this.geometry = new THREE.SphereGeometry(size, 6, 6);
    this.material = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: opacity,
      depthWrite: false,
    });
  }

  emit(position: THREE.Vector3, velocity: THREE.Vector3, maxLife: number = 1.2, scale: number = 1) {
    let mesh: THREE.Mesh;
    if (this.pool.length > 0) {
      mesh = this.pool.pop()!;
      mesh.visible = true;
    } else {
      mesh = new THREE.Mesh(this.geometry, this.material.clone());
      this.group.add(mesh);
    }

    mesh.position.copy(position);
    mesh.scale.setScalar(scale);

    this.particles.push({
      mesh,
      velocity: velocity.clone(),
      life: maxLife,
      maxLife,
      initialScale: scale,
    });
  }

  update(delta: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= delta;

      if (p.life <= 0) {
        p.mesh.visible = false;
        this.pool.push(p.mesh);
        this.particles.splice(i, 1);
      } else {
        p.mesh.position.addScaledVector(p.velocity, delta);
        const progress = 1 - p.life / p.maxLife;
        const currentScale = p.initialScale * (1 + progress * 2.5);
        p.mesh.scale.setScalar(currentScale);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.45;
      }
    }
  }

  dispose() {
    this.particles.forEach((p) => {
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    });
    this.pool.forEach((m) => {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    this.particles = [];
    this.pool = [];
    this.geometry.dispose();
    this.material.dispose();
  }
}

// -------------------------------------------------------------
// Procedural 3D Vehicle Factory
// -------------------------------------------------------------

export function create3DVehicle(mode: TransportMode): Vehicle3DInstance {
  const rootGroup = new THREE.Group();
  const animatedParts: (() => void)[] = [];
  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  // Helper material creators
  const createPBR = (color: number, roughness = 0.3, metalness = 0.5) => {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
    });
    disposables.push(mat);
    return mat;
  };

  const createEmissive = (color: number, emissive: number, intensity = 2.0) => {
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: intensity,
      roughness: 0.1,
    });
    disposables.push(mat);
    return mat;
  };

  const trackGeom = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  let particleSystem: VehicleParticleSystem | null = null;
  let emitTimer = 0;

  switch (mode) {
    // -----------------------------------------------------------
    // 1. AIRPLANE / JET AIRLINER
    // -----------------------------------------------------------
    case 'airplane': {
      particleSystem = new VehicleParticleSystem(0xffffff, 0.6, 2.5);
      rootGroup.add(particleSystem.group);

      const bodyMat = createPBR(0xffffff, 0.2, 0.4);
      const accentMat = createPBR(0x0284c7, 0.3, 0.6); // Cyan airline stripe
      const glassMat = createPBR(0x0f172a, 0.1, 0.9); // Cockpit glass
      const metalMat = createPBR(0x94a3b8, 0.4, 0.8);
      const lightRed = createEmissive(0xef4444, 0xef4444, 3);
      const lightGreen = createEmissive(0x22c55e, 0x22c55e, 3);
      const engineGlow = createEmissive(0x38bdf8, 0x0284c7, 4);

      // Fuselage (Streamlined body)
      const fuselageGeom = trackGeom(new THREE.CylinderGeometry(3.5, 3.2, 38, 16));
      fuselageGeom.rotateX(Math.PI / 2);
      const fuselage = new THREE.Mesh(fuselageGeom, bodyMat);
      rootGroup.add(fuselage);

      // Nose cone
      const noseGeom = trackGeom(new THREE.ConeGeometry(3.5, 12, 16));
      noseGeom.rotateX(Math.PI / 2);
      const nose = new THREE.Mesh(noseGeom, bodyMat);
      nose.position.z = 25;
      rootGroup.add(nose);

      // Cockpit windshield
      const cockpitGeom = trackGeom(new THREE.SphereGeometry(3.4, 12, 12, 0, Math.PI * 2, 0, Math.PI / 3));
      cockpitGeom.rotateX(-Math.PI / 4);
      const cockpit = new THREE.Mesh(cockpitGeom, glassMat);
      cockpit.position.set(0, 1.2, 22);
      rootGroup.add(cockpit);

      // Airline decorative stripe
      const stripeGeom = trackGeom(new THREE.CylinderGeometry(3.55, 3.25, 20, 16));
      stripeGeom.rotateX(Math.PI / 2);
      const stripe = new THREE.Mesh(stripeGeom, accentMat);
      stripe.position.z = 2;
      rootGroup.add(stripe);

      // Main Wings (Swept-back)
      const wingShape = new THREE.Shape();
      wingShape.moveTo(0, 0);
      wingShape.lineTo(26, -12);
      wingShape.lineTo(25, -16);
      wingShape.lineTo(0, -6);
      wingShape.closePath();

      const wingExtrudeSettings = { depth: 0.8, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.2, bevelThickness: 0.2 };
      const rightWingGeom = trackGeom(new THREE.ExtrudeGeometry(wingShape, wingExtrudeSettings));
      rightWingGeom.rotateX(Math.PI / 2);
      const rightWing = new THREE.Mesh(rightWingGeom, bodyMat);
      rightWing.position.set(0, 0, 4);
      rootGroup.add(rightWing);

      const leftWingShape = new THREE.Shape();
      leftWingShape.moveTo(0, 0);
      leftWingShape.lineTo(-26, -12);
      leftWingShape.lineTo(-25, -16);
      leftWingShape.lineTo(0, -6);
      leftWingShape.closePath();
      const leftWingGeom = trackGeom(new THREE.ExtrudeGeometry(leftWingShape, wingExtrudeSettings));
      leftWingGeom.rotateX(Math.PI / 2);
      const leftWing = new THREE.Mesh(leftWingGeom, bodyMat);
      leftWing.position.set(0, 0, 4);
      rootGroup.add(leftWing);

      // Wingtip Navigation Lights
      const navLightGeom = trackGeom(new THREE.SphereGeometry(0.7, 8, 8));
      const leftLight = new THREE.Mesh(navLightGeom, lightRed);
      leftLight.position.set(-25.5, 0.4, -10);
      rootGroup.add(leftLight);

      const rightLight = new THREE.Mesh(navLightGeom, lightGreen);
      rightLight.position.set(25.5, 0.4, -10);
      rootGroup.add(rightLight);

      // Vertical Tail Fin
      const tailShape = new THREE.Shape();
      tailShape.moveTo(0, 0);
      tailShape.lineTo(0, 14);
      tailShape.lineTo(-8, 14);
      tailShape.lineTo(-12, 0);
      tailShape.closePath();
      const tailGeom = trackGeom(new THREE.ExtrudeGeometry(tailShape, { depth: 0.7, bevelEnabled: false }));
      tailGeom.rotateY(Math.PI / 2);
      const tail = new THREE.Mesh(tailGeom, accentMat);
      tail.position.set(-0.35, 3.2, -18);
      rootGroup.add(tail);

      // Horizontal Stabilizers
      const hTailShape = new THREE.Shape();
      hTailShape.moveTo(0, 0);
      hTailShape.lineTo(10, -5);
      hTailShape.lineTo(9, -7);
      hTailShape.lineTo(0, -3);
      hTailShape.closePath();
      const hTailR = new THREE.Mesh(trackGeom(new THREE.ExtrudeGeometry(hTailShape, { depth: 0.5 })), bodyMat);
      hTailR.rotation.x = Math.PI / 2;
      hTailR.position.set(0, 2, -16);
      rootGroup.add(hTailR);

      const hTailLShape = new THREE.Shape();
      hTailLShape.moveTo(0, 0);
      hTailLShape.lineTo(-10, -5);
      hTailLShape.lineTo(-9, -7);
      hTailLShape.lineTo(0, -3);
      hTailLShape.closePath();
      const hTailL = new THREE.Mesh(trackGeom(new THREE.ExtrudeGeometry(hTailLShape, { depth: 0.5 })), bodyMat);
      hTailL.rotation.x = Math.PI / 2;
      hTailL.position.set(0, 2, -16);
      rootGroup.add(hTailL);

      // Jet Engines (Under wings)
      [-9, 9].forEach((xPos) => {
        const podGeom = trackGeom(new THREE.CylinderGeometry(1.6, 1.4, 9, 12));
        podGeom.rotateX(Math.PI / 2);
        const pod = new THREE.Mesh(podGeom, metalMat);
        pod.position.set(xPos, -2.5, 0);
        rootGroup.add(pod);

        // Exhaust glowing cone
        const exhaustGeom = trackGeom(new THREE.ConeGeometry(1.2, 3, 12));
        exhaustGeom.rotateX(-Math.PI / 2);
        const exhaust = new THREE.Mesh(exhaustGeom, engineGlow);
        exhaust.position.set(xPos, -2.5, -5.5);
        rootGroup.add(exhaust);
      });

      break;
    }

    // -----------------------------------------------------------
    // 2. SPORTS CAR / SUPERCAR
    // -----------------------------------------------------------
    case 'sports_car': {
      particleSystem = new VehicleParticleSystem(0x64748b, 0.4, 1.8);
      rootGroup.add(particleSystem.group);

      const carPaintMat = createPBR(0xef4444, 0.15, 0.8); // Rosso Corsa Red
      const chassisMat = createPBR(0x0f172a, 0.5, 0.2); // Carbon dark
      const windowMat = createPBR(0x1e293b, 0.1, 0.95);
      const wheelMat = createPBR(0x18181b, 0.7, 0.3);
      const rimMat = createPBR(0xe2e8f0, 0.2, 0.9);
      const headlightMat = createEmissive(0x38bdf8, 0xffffff, 4);
      const taillightMat = createEmissive(0xff2222, 0xff0000, 4);

      // Car Main Body (Sculpted low-slung)
      const bodyGeom = trackGeom(new THREE.BoxGeometry(11, 3.8, 24));
      const body = new THREE.Mesh(bodyGeom, carPaintMat);
      body.position.y = 3.2;
      rootGroup.add(body);

      // Cabin / Glass Cockpit
      const cabinGeom = trackGeom(new THREE.BoxGeometry(9.2, 3.2, 13));
      const cabin = new THREE.Mesh(cabinGeom, windowMat);
      cabin.position.set(0, 6.2, -1);
      rootGroup.add(cabin);

      // Hood slope
      const hoodGeom = trackGeom(new THREE.CylinderGeometry(4.5, 5.5, 10, 4));
      hoodGeom.rotateZ(Math.PI / 4);
      hoodGeom.rotateX(Math.PI / 2);
      const hood = new THREE.Mesh(hoodGeom, carPaintMat);
      hood.position.set(0, 4, 8);
      rootGroup.add(hood);

      // Rear Spoiler / Wing
      const spoilerWing = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(11.5, 0.5, 3)), chassisMat);
      spoilerWing.position.set(0, 6.5, -11.5);
      rootGroup.add(spoilerWing);
      const postL = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(0.5, 2, 0.5)), chassisMat);
      postL.position.set(-3.5, 5.2, -11.5);
      rootGroup.add(postL);
      const postR = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(0.5, 2, 0.5)), chassisMat);
      postR.position.set(3.5, 5.2, -11.5);
      rootGroup.add(postR);

      // Glowing LED Headlights
      const hlGeom = trackGeom(new THREE.BoxGeometry(2.5, 0.8, 0.5));
      const hlLeft = new THREE.Mesh(hlGeom, headlightMat);
      hlLeft.position.set(-3.8, 3.6, 12.1);
      rootGroup.add(hlLeft);
      const hlRight = new THREE.Mesh(hlGeom, headlightMat);
      hlRight.position.set(3.8, 3.6, 12.1);
      rootGroup.add(hlRight);

      // Volumetric Forward Light Cones
      const coneGeom = trackGeom(new THREE.ConeGeometry(5, 25, 16));
      coneGeom.rotateX(Math.PI / 2);
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      });
      disposables.push(beamMat);
      const beamL = new THREE.Mesh(coneGeom, beamMat);
      beamL.position.set(-3.8, 3.5, 24);
      rootGroup.add(beamL);
      const beamR = new THREE.Mesh(coneGeom, beamMat);
      beamR.position.set(3.8, 3.5, 24);
      rootGroup.add(beamR);

      // Taillights
      const tlGeom = trackGeom(new THREE.BoxGeometry(10.5, 0.6, 0.4));
      const tlBar = new THREE.Mesh(tlGeom, taillightMat);
      tlBar.position.set(0, 3.8, -12.1);
      rootGroup.add(tlBar);

      // 4 Wheels with Rims that rotate!
      const wheelGeom = trackGeom(new THREE.CylinderGeometry(2.3, 2.3, 1.4, 16));
      wheelGeom.rotateZ(Math.PI / 2);
      const rimGeom = trackGeom(new THREE.CylinderGeometry(1.5, 1.5, 1.45, 8));
      rimGeom.rotateZ(Math.PI / 2);

      const wheels: THREE.Group[] = [];
      const wheelPositions = [
        { x: -5.6, y: 2.3, z: 7.5, isFront: true },
        { x: 5.6, y: 2.3, z: 7.5, isFront: true },
        { x: -5.6, y: 2.3, z: -7.5, isFront: false },
        { x: 5.6, y: 2.3, z: -7.5, isFront: false },
      ];

      wheelPositions.forEach((pos) => {
        const wheelGroup = new THREE.Group();
        wheelGroup.position.set(pos.x, pos.y, pos.z);

        const tire = new THREE.Mesh(wheelGeom, wheelMat);
        const rim = new THREE.Mesh(rimGeom, rimMat);
        wheelGroup.add(tire);
        wheelGroup.add(rim);
        rootGroup.add(wheelGroup);
        wheels.push(wheelGroup);

        animatedParts.push(() => {
          // Wheel spin around X axis
          tire.rotation.x += 0.2;
          rim.rotation.x += 0.2;
        });
      });

      break;
    }

    // -----------------------------------------------------------
    // 3. OVERLAND 4X4 SUV / EXPEDITION JEEP
    // -----------------------------------------------------------
    case 'suv':
    case 'bus':
    case 'camper': {
      particleSystem = new VehicleParticleSystem(0xd97706, 0.35, 2.0); // Desert trail dust
      rootGroup.add(particleSystem.group);

      const bodyColor = mode === 'camper' ? 0x0284c7 : 0xeab308; // Safari Gold or Camper Blue
      const bodyMat = createPBR(bodyColor, 0.3, 0.4);
      const trimMat = createPBR(0x18181b, 0.8, 0.2);
      const windowMat = createPBR(0x0f172a, 0.1, 0.9);
      const tireMat = createPBR(0x27272a, 0.8, 0.1);

      // Rugged Main Body
      const body = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(12, 6, 22)), bodyMat);
      body.position.y = 5.5;
      rootGroup.add(body);

      // Cabin with large safari windows
      const cabin = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(11, 4.5, 14)), windowMat);
      cabin.position.set(0, 9.5, -2);
      rootGroup.add(cabin);

      // Roof Rack with luggage
      const rack = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(10.5, 0.8, 13)), trimMat);
      rack.position.set(0, 12.2, -2);
      rootGroup.add(rack);

      const luggage1 = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(4, 2, 5)), createPBR(0x059669, 0.5, 0.2));
      luggage1.position.set(-2, 13.5, -3);
      rootGroup.add(luggage1);
      const luggage2 = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(3.5, 1.8, 4)), createPBR(0xd97706, 0.5, 0.2));
      luggage2.position.set(2.5, 13.4, -1);
      rootGroup.add(luggage2);

      // Spare Tire on Rear Door
      const spareTire = new THREE.Mesh(trackGeom(new THREE.CylinderGeometry(2.8, 2.8, 1.8, 16)), tireMat);
      spareTire.rotation.x = Math.PI / 2;
      spareTire.position.set(0, 6.5, -12);
      rootGroup.add(spareTire);

      // Big Chunky Off-Road Wheels
      const wheelGeom = trackGeom(new THREE.CylinderGeometry(3.2, 3.2, 2.2, 16));
      wheelGeom.rotateZ(Math.PI / 2);

      [
        { x: -6.4, y: 3.2, z: 6.8 },
        { x: 6.4, y: 3.2, z: 6.8 },
        { x: -6.4, y: 3.2, z: -6.8 },
        { x: 6.4, y: 3.2, z: -6.8 },
      ].forEach((p) => {
        const wheel = new THREE.Mesh(wheelGeom, tireMat);
        wheel.position.set(p.x, p.y, p.z);
        rootGroup.add(wheel);
        animatedParts.push(() => {
          wheel.rotation.x += 0.15;
        });
      });

      break;
    }

    // -----------------------------------------------------------
    // 4. HIGH-SPEED BULLET TRAIN (SHINKANSEN / TGV)
    // -----------------------------------------------------------
    case 'bullet_train': {
      const trainWhite = createPBR(0xf8fafc, 0.2, 0.5);
      const stripeBlue = createPBR(0x2563eb, 0.2, 0.6);
      const glassMat = createPBR(0x0f172a, 0.1, 0.95);
      const undercarriageMat = createPBR(0x334155, 0.7, 0.3);
      const headlightMat = createEmissive(0xfef08a, 0xfef08a, 4);

      // Locomotive Body
      const leadCar = new THREE.Group();
      rootGroup.add(leadCar);

      const body = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(8, 7, 34)), trainWhite);
      body.position.y = 4.5;
      leadCar.add(body);

      // Aerodynamic Long Bullet Nose
      const nose = new THREE.Mesh(trackGeom(new THREE.ConeGeometry(4.2, 16, 16)), trainWhite);
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, 4.2, 24);
      leadCar.add(nose);

      // Cabin Windshield
      const cockpit = new THREE.Mesh(trackGeom(new THREE.SphereGeometry(3.8, 12, 12, 0, Math.PI * 2, 0, Math.PI / 2.5)), glassMat);
      cockpit.rotation.x = -Math.PI / 3;
      cockpit.position.set(0, 6.2, 20);
      leadCar.add(cockpit);

      // Speed Stripe
      const stripe = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(8.2, 1.2, 36)), stripeBlue);
      stripe.position.set(0, 3.5, 0);
      leadCar.add(stripe);

      // Continuous Passenger Window Band
      const windows = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(8.15, 1.5, 26)), glassMat);
      windows.position.set(0, 5.5, -2);
      leadCar.add(windows);

      // Headlights on nose
      const hl1 = new THREE.Mesh(trackGeom(new THREE.SphereGeometry(0.7, 8, 8)), headlightMat);
      hl1.position.set(-1.8, 3.2, 29);
      leadCar.add(hl1);
      const hl2 = new THREE.Mesh(trackGeom(new THREE.SphereGeometry(0.7, 8, 8)), headlightMat);
      hl2.position.set(1.8, 3.2, 29);
      leadCar.add(hl2);

      // Undercarriage Bogies
      const bogie1 = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(7, 1.8, 10)), undercarriageMat);
      bogie1.position.set(0, 1, 10);
      leadCar.add(bogie1);
      const bogie2 = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(7, 1.8, 10)), undercarriageMat);
      bogie2.position.set(0, 1, -10);
      leadCar.add(bogie2);

      // Second Passenger Carriage (trailing behind!)
      const coachCar = new THREE.Group();
      coachCar.position.z = -40;
      rootGroup.add(coachCar);

      const coachBody = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(8, 7, 36)), trainWhite);
      coachBody.position.y = 4.5;
      coachCar.add(coachBody);
      const coachStripe = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(8.2, 1.2, 36)), stripeBlue);
      coachStripe.position.set(0, 3.5, 0);
      coachCar.add(coachStripe);
      const coachWindows = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(8.15, 1.5, 30)), glassMat);
      coachWindows.position.set(0, 5.5, 0);
      coachCar.add(coachWindows);

      // Pantograph on coach roof
      const pantograph = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(3, 2.5, 5)), createPBR(0xd97706, 0.4, 0.7));
      pantograph.position.set(0, 9, 5);
      coachCar.add(pantograph);

      break;
    }

    // -----------------------------------------------------------
    // 5. VINTAGE STEAM LOCOMOTIVE
    // -----------------------------------------------------------
    case 'steam_train': {
      particleSystem = new VehicleParticleSystem(0xf1f5f9, 0.75, 3.5); // Billowing white steam puffs
      rootGroup.add(particleSystem.group);

      const ironMat = createPBR(0x18181b, 0.6, 0.7);
      const brassMat = createPBR(0xd97706, 0.2, 0.9);
      const redMat = createPBR(0xdc2626, 0.4, 0.4);

      // Cylindrical Boiler
      const boilerGeom = trackGeom(new THREE.CylinderGeometry(4.2, 4.2, 22, 16));
      boilerGeom.rotateX(Math.PI / 2);
      const boiler = new THREE.Mesh(boilerGeom, ironMat);
      boiler.position.set(0, 6.5, 5);
      rootGroup.add(boiler);

      // Driver's Cabin
      const cab = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(9.5, 9, 11)), ironMat);
      cab.position.set(0, 8.5, -9);
      rootGroup.add(cab);

      // Tall Smokestack
      const stack = new THREE.Mesh(trackGeom(new THREE.CylinderGeometry(1.8, 1.2, 5, 12)), brassMat);
      stack.position.set(0, 12, 13);
      rootGroup.add(stack);

      // Gold Dome & Bell
      const dome = new THREE.Mesh(trackGeom(new THREE.SphereGeometry(2, 12, 12)), brassMat);
      dome.position.set(0, 11, 4);
      rootGroup.add(dome);

      // Cowcatcher at front
      const cowcatcher = new THREE.Mesh(trackGeom(new THREE.ConeGeometry(4.5, 5, 4)), redMat);
      cowcatcher.rotation.x = Math.PI / 2;
      cowcatcher.rotation.z = Math.PI / 4;
      cowcatcher.position.set(0, 2.5, 17);
      rootGroup.add(cowcatcher);

      // Driving Wheels
      const driveWheelGeom = trackGeom(new THREE.CylinderGeometry(3.8, 3.8, 1.2, 16));
      driveWheelGeom.rotateZ(Math.PI / 2);
      [-6, 0, 6].forEach((z) => {
        const wL = new THREE.Mesh(driveWheelGeom, redMat);
        wL.position.set(-5, 3.8, z);
        rootGroup.add(wL);
        const wR = new THREE.Mesh(driveWheelGeom, redMat);
        wR.position.set(5, 3.8, z);
        rootGroup.add(wR);
        animatedParts.push(() => {
          wL.rotation.x += 0.2;
          wR.rotation.x += 0.2;
        });
      });

      break;
    }

    // -----------------------------------------------------------
    // 6. MOTORCYCLE / ADVENTURE BIKE
    // -----------------------------------------------------------
    case 'motorcycle': {
      const bikePaintMat = createPBR(0xf97316, 0.2, 0.7); // Vivid Orange
      const metalMat = createPBR(0x64748b, 0.3, 0.8);
      const tireMat = createPBR(0x0f172a, 0.8, 0.2);
      const headlightMat = createEmissive(0x38bdf8, 0xffffff, 4);

      // Frame
      const frame = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(3, 4, 12)), metalMat);
      frame.position.set(0, 4, 0);
      rootGroup.add(frame);

      // Gas Tank
      const tank = new THREE.Mesh(trackGeom(new THREE.CylinderGeometry(1.8, 1.4, 6, 12)), bikePaintMat);
      tank.rotation.x = Math.PI / 2;
      tank.position.set(0, 6.2, 1.5);
      rootGroup.add(tank);

      // Handlebars
      const handlebar = new THREE.Mesh(trackGeom(new THREE.CylinderGeometry(0.3, 0.3, 7, 8)), metalMat);
      handlebar.rotation.z = Math.PI / 2;
      handlebar.position.set(0, 7.5, 4.5);
      rootGroup.add(handlebar);

      // Headlight
      const hl = new THREE.Mesh(trackGeom(new THREE.SphereGeometry(1, 10, 10)), headlightMat);
      hl.position.set(0, 6.5, 6);
      rootGroup.add(hl);

      // Wheels
      const wheelGeom = trackGeom(new THREE.CylinderGeometry(2.5, 2.5, 1, 16));
      wheelGeom.rotateZ(Math.PI / 2);
      const frontWheel = new THREE.Mesh(wheelGeom, tireMat);
      frontWheel.position.set(0, 2.5, 6);
      rootGroup.add(frontWheel);

      const rearWheel = new THREE.Mesh(wheelGeom, tireMat);
      rearWheel.position.set(0, 2.5, -6);
      rootGroup.add(rearWheel);

      animatedParts.push(() => {
        frontWheel.rotation.x += 0.25;
        rearWheel.rotation.x += 0.25;
      });

      // Rider Figure (Stylized with Helmet)
      const riderMat = createPBR(0x1e293b, 0.5, 0.2);
      const helmetMat = createPBR(0xffffff, 0.2, 0.5);

      const riderTorso = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(3, 5, 3)), riderMat);
      riderTorso.rotation.x = -Math.PI / 8; // Leaning forward
      riderTorso.position.set(0, 8.5, -1);
      rootGroup.add(riderTorso);

      const helmet = new THREE.Mesh(trackGeom(new THREE.SphereGeometry(1.6, 12, 12)), helmetMat);
      helmet.position.set(0, 12, 0);
      rootGroup.add(helmet);

      break;
    }

    // -----------------------------------------------------------
    // 7. LUXURY YACHT / CRUISE SHIP / FERRY
    // -----------------------------------------------------------
    case 'yacht':
    case 'ferry': {
      particleSystem = new VehicleParticleSystem(0xe0f2fe, 0.6, 3.0); // Expanding water wake foam
      rootGroup.add(particleSystem.group);

      const hullMat = createPBR(0x0f172a, 0.2, 0.6); // Midnight Navy Hull
      const deckMat = createPBR(0xd97706, 0.6, 0.2); // Teak wood deck
      const superMat = createPBR(0xffffff, 0.1, 0.3); // Brilliant white superstructure
      const glassMat = createPBR(0x38bdf8, 0.1, 0.95);

      // Hydrodynamic Hull
      const hullShape = new THREE.Shape();
      hullShape.moveTo(-6, -18);
      hullShape.lineTo(6, -18);
      hullShape.lineTo(6.5, 6);
      hullShape.lineTo(0, 22); // Sharp bow
      hullShape.lineTo(-6.5, 6);
      hullShape.closePath();

      const hullExtrude = trackGeom(new THREE.ExtrudeGeometry(hullShape, { depth: 4.5, bevelEnabled: true, bevelThickness: 1, bevelSize: 0.8 }));
      hullExtrude.rotateX(Math.PI / 2);
      const hull = new THREE.Mesh(hullExtrude, hullMat);
      hull.position.y = 2.5;
      rootGroup.add(hull);

      // Main Deck
      const deck = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(11, 0.4, 30)), deckMat);
      deck.position.set(0, 3.2, 0);
      rootGroup.add(deck);

      // Superstructure Tier 1
      const cabin1 = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(8.5, 3.5, 18)), superMat);
      cabin1.position.set(0, 5, -2);
      rootGroup.add(cabin1);

      // Observation Bridge Tier 2
      const cabin2 = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(6.5, 3, 11)), superMat);
      cabin2.position.set(0, 8, -1);
      rootGroup.add(cabin2);

      // Panoramic Glass Windows
      const windows = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(6.7, 1.4, 9)), glassMat);
      windows.position.set(0, 8.2, 0);
      rootGroup.add(windows);

      // Radar Mast
      const mast = new THREE.Mesh(trackGeom(new THREE.CylinderGeometry(0.3, 0.3, 5, 8)), superMat);
      mast.position.set(0, 11.5, -2);
      rootGroup.add(mast);

      const radar = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(3, 0.4, 0.8)), superMat);
      radar.position.set(0, 14, -2);
      rootGroup.add(radar);
      animatedParts.push(() => {
        radar.rotation.y += 0.1;
      });

      break;
    }

    // -----------------------------------------------------------
    // 8. 3D HIKER / BACKPACK TRAVELER / PERSON
    // -----------------------------------------------------------
    case 'hiker':
    case 'bicycle': {
      const skinMat = createPBR(0xfcd34d, 0.6, 0.1);
      const jacketMat = createPBR(0xef4444, 0.5, 0.2); // Vibrant red jacket
      const pantsMat = createPBR(0x1e3a8a, 0.5, 0.2); // Blue hiking pants
      const backpackMat = createPBR(0x065f46, 0.6, 0.2); // Forest green backpack
      const hatMat = createPBR(0xd97706, 0.6, 0.1); // Explorer sunhat

      // Torso / Jacket
      const torso = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(3.6, 4.8, 2.2)), jacketMat);
      torso.position.y = 8.5;
      rootGroup.add(torso);

      // Head & Sunhat
      const head = new THREE.Mesh(trackGeom(new THREE.SphereGeometry(1.5, 12, 12)), skinMat);
      head.position.set(0, 12.2, 0);
      rootGroup.add(head);

      const hatBrim = new THREE.Mesh(trackGeom(new THREE.CylinderGeometry(3.2, 3.2, 0.3, 16)), hatMat);
      hatBrim.position.set(0, 13, 0);
      rootGroup.add(hatBrim);

      const hatCrown = new THREE.Mesh(trackGeom(new THREE.CylinderGeometry(1.6, 1.8, 1.2, 16)), hatMat);
      hatCrown.position.set(0, 13.7, 0);
      rootGroup.add(hatCrown);

      // Big Hiking Backpack
      const backpack = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(3.4, 5.2, 2.6)), backpackMat);
      backpack.position.set(0, 8.5, -2.2);
      rootGroup.add(backpack);

      // Sleeping Mat Roll
      const matRoll = new THREE.Mesh(trackGeom(new THREE.CylinderGeometry(1, 1, 4.2, 12)), createPBR(0x0284c7, 0.5, 0.2));
      matRoll.rotation.z = Math.PI / 2;
      matRoll.position.set(0, 11.5, -2.2);
      rootGroup.add(matRoll);

      // Animated Walking Legs
      const legGeom = trackGeom(new THREE.BoxGeometry(1.4, 5.8, 1.4));
      const leftLeg = new THREE.Mesh(legGeom, pantsMat);
      leftLeg.position.set(-1.1, 3, 0);
      rootGroup.add(leftLeg);

      const rightLeg = new THREE.Mesh(legGeom, pantsMat);
      rightLeg.position.set(1.1, 3, 0);
      rootGroup.add(rightLeg);

      // Animated Swinging Arms
      const armGeom = trackGeom(new THREE.BoxGeometry(1, 4.5, 1));
      const leftArm = new THREE.Mesh(armGeom, jacketMat);
      leftArm.position.set(-2.4, 8, 0);
      rootGroup.add(leftArm);

      const rightArm = new THREE.Mesh(armGeom, jacketMat);
      rightArm.position.set(2.4, 8, 0);
      rootGroup.add(rightArm);

      let walkCycle = 0;
      animatedParts.push(() => {
        walkCycle += 0.22;
        const angle = Math.sin(walkCycle) * 0.5;
        leftLeg.rotation.x = angle;
        rightLeg.rotation.x = -angle;
        leftArm.rotation.x = -angle;
        rightArm.rotation.x = angle;
      });

      break;
    }

    // -----------------------------------------------------------
    // 9. HELICOPTER
    // -----------------------------------------------------------
    case 'helicopter': {
      const heliPaintMat = createPBR(0x0284c7, 0.2, 0.7); // Electric Blue
      const glassMat = createPBR(0x0f172a, 0.1, 0.95);
      const bladeMat = createPBR(0x1e293b, 0.4, 0.8);
      const metalMat = createPBR(0x94a3b8, 0.3, 0.8);

      // Fuselage Cabin
      const cabin = new THREE.Mesh(trackGeom(new THREE.SphereGeometry(5, 16, 16)), heliPaintMat);
      cabin.scale.set(1, 1, 1.6);
      cabin.position.set(0, 6, 2);
      rootGroup.add(cabin);

      // Bubble Canopy Glass
      const canopy = new THREE.Mesh(trackGeom(new THREE.SphereGeometry(4.8, 14, 14, 0, Math.PI * 2, 0, Math.PI / 2.2)), glassMat);
      canopy.scale.set(0.95, 0.95, 1.5);
      canopy.rotation.x = -Math.PI / 4;
      canopy.position.set(0, 6.5, 5);
      rootGroup.add(canopy);

      // Tail Boom
      const tailBoom = new THREE.Mesh(trackGeom(new THREE.CylinderGeometry(0.8, 1.8, 18, 12)), heliPaintMat);
      tailBoom.rotation.x = Math.PI / 2;
      tailBoom.position.set(0, 6.5, -11);
      rootGroup.add(tailBoom);

      // Tail Fin & Small Rotor
      const tailFin = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(0.4, 4, 3)), heliPaintMat);
      tailFin.position.set(0, 8.5, -19);
      rootGroup.add(tailFin);

      const tailRotor = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(0.2, 5, 0.6)), bladeMat);
      tailRotor.position.set(0.6, 9.5, -19);
      rootGroup.add(tailRotor);

      // Main Rotor Mast & Spinning Blades
      const rotorMast = new THREE.Mesh(trackGeom(new THREE.CylinderGeometry(0.6, 0.6, 3, 8)), metalMat);
      rotorMast.position.set(0, 11.5, 2);
      rootGroup.add(rotorMast);

      const mainRotorGroup = new THREE.Group();
      mainRotorGroup.position.set(0, 13, 2);
      rootGroup.add(mainRotorGroup);

      const bladeGeom = trackGeom(new THREE.BoxGeometry(32, 0.2, 1.8));
      const blade1 = new THREE.Mesh(bladeGeom, bladeMat);
      const blade2 = new THREE.Mesh(bladeGeom, bladeMat);
      blade2.rotation.y = Math.PI / 2;
      mainRotorGroup.add(blade1);
      mainRotorGroup.add(blade2);

      // Landing Skids
      const skidL = new THREE.Mesh(trackGeom(new THREE.CylinderGeometry(0.4, 0.4, 16, 8)), metalMat);
      skidL.rotation.x = Math.PI / 2;
      skidL.position.set(-3.5, 1.2, 2);
      rootGroup.add(skidL);

      const skidR = new THREE.Mesh(trackGeom(new THREE.CylinderGeometry(0.4, 0.4, 16, 8)), metalMat);
      skidR.rotation.x = Math.PI / 2;
      skidR.position.set(3.5, 1.2, 2);
      rootGroup.add(skidR);

      animatedParts.push(() => {
        mainRotorGroup.rotation.y += 0.45;
        tailRotor.rotation.x += 0.55;
      });

      break;
    }

    // -----------------------------------------------------------
    // 10. HOT AIR BALLOON
    // -----------------------------------------------------------
    case 'balloon': {
      const redMat = createPBR(0xef4444, 0.4, 0.1);
      const yellowMat = createPBR(0xfacc15, 0.4, 0.1);
      const basketMat = createPBR(0xb45309, 0.8, 0.1);
      const flameMat = createEmissive(0xf97316, 0xffedd5, 5);

      // Teardrop Balloon Envelope
      const envelope = new THREE.Mesh(trackGeom(new THREE.SphereGeometry(14, 24, 16)), redMat);
      envelope.scale.set(1, 1.4, 1);
      envelope.position.set(0, 26, 0);
      rootGroup.add(envelope);

      // Decorative colorful waist band
      const waistBand = new THREE.Mesh(trackGeom(new THREE.TorusGeometry(13.8, 1.2, 8, 24)), yellowMat);
      waistBand.rotation.x = Math.PI / 2;
      waistBand.position.set(0, 26, 0);
      rootGroup.add(waistBand);

      // Burner Ring & Flame
      const burner = new THREE.Mesh(trackGeom(new THREE.CylinderGeometry(1.5, 1.5, 1.5, 12)), createPBR(0x334155, 0.3, 0.8));
      burner.position.set(0, 9, 0);
      rootGroup.add(burner);

      const flame = new THREE.Mesh(trackGeom(new THREE.ConeGeometry(1.2, 3, 10)), flameMat);
      flame.position.set(0, 11, 0);
      rootGroup.add(flame);

      // Wicker Passenger Basket
      const basket = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(6, 4.5, 6)), basketMat);
      basket.position.set(0, 3, 0);
      rootGroup.add(basket);

      animatedParts.push(() => {
        flame.scale.y = 0.8 + Math.random() * 0.4;
      });

      break;
    }

    // Default / Propeller airplane
    case 'propeller':
    default: {
      particleSystem = new VehicleParticleSystem(0xffffff, 0.5, 2.0);
      rootGroup.add(particleSystem.group);

      const yellowMat = createPBR(0xf59e0b, 0.2, 0.5); // Vintage Aviator Yellow
      const glassMat = createPBR(0x0f172a, 0.1, 0.9);
      const propMat = createPBR(0x18181b, 0.4, 0.8);

      const body = new THREE.Mesh(trackGeom(new THREE.CylinderGeometry(2.5, 1.5, 24, 12)), yellowMat);
      body.rotation.x = Math.PI / 2;
      body.position.set(0, 3, 0);
      rootGroup.add(body);

      // High wing
      const wing = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(32, 0.6, 6)), yellowMat);
      wing.position.set(0, 5.8, 2);
      rootGroup.add(wing);

      // Cockpit
      const cockpit = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(3.2, 2.5, 6)), glassMat);
      cockpit.position.set(0, 4.5, 4);
      rootGroup.add(cockpit);

      // Propeller spinning disc
      const propGroup = new THREE.Group();
      propGroup.position.set(0, 3, 12.2);
      rootGroup.add(propGroup);

      const blade = new THREE.Mesh(trackGeom(new THREE.BoxGeometry(8, 0.6, 0.2)), propMat);
      propGroup.add(blade);

      animatedParts.push(() => {
        propGroup.rotation.z += 0.5;
      });
      break;
    }
  }

  // Animation and tick handler
  const updateAnimation = (delta: number, _speed: number, _turningAngle: number, isMoving: boolean) => {
    // Tick animated subparts (wheels, propellers, walking stride)
    if (isMoving) {
      animatedParts.forEach((fn) => fn());
    }

    // Particle emissions
    if (particleSystem && isMoving) {
      emitTimer += delta;
      if (emitTimer > 0.04) {
        emitTimer = 0;
        const tailOffset = new THREE.Vector3(0, 0, -10).applyQuaternion(rootGroup.quaternion);
        const emitPos = rootGroup.position.clone().add(tailOffset);
        const velocity = new THREE.Vector3(
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5
        );
        particleSystem.emit(emitPos, velocity, 1.0, 1.2);
      }
    }

    if (particleSystem) {
      particleSystem.update(delta);
    }
  };

  const dispose = () => {
    if (particleSystem) {
      particleSystem.dispose();
    }
    disposables.forEach((item) => item.dispose());
  };

  return {
    group: rootGroup,
    updateAnimation,
    dispose,
    type: mode,
  };
}
