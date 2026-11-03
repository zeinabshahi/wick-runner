// HAUNT THE CHAIN scenery: jack-o'-lanterns, bat flocks, floating ghosts, graveyard islands, a moon.
// Visual only (never touches colliders or sim state), so replays stay verifiable.
export function buildHaunt(THREE, density = 1) { // density < 1 thins the animated crowd (bats, ghosts) for phones
  let s = 1031; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; // seeded: same scene every load
  const group = new THREE.Group(); group.visible = false;
  const tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };

  // Jack-o'-lantern: ribbed pumpkin + carved face glowing through (additive, so bloom catches it)
  const pumpGeo = new THREE.SphereGeometry(1, 28, 18), pp = pumpGeo.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i), a = Math.atan2(z, x), rib = 1 - .09 * (.5 - .5 * Math.cos(a * 10));
    pp.setXYZ(i, x * rib * 1.12, y * .82 - (Math.abs(y) > .9 ? (y > 0 ? .08 : -.04) : 0), z * rib * 1.12);
  }
  pumpGeo.computeVertexNormals();
  const pumpMat = new THREE.MeshStandardMaterial({ color: 0xff6a00, emissive: 0x5a1800, roughness: .55 });
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3b5a22, roughness: .9 }), stemGeo = new THREE.CylinderGeometry(.07, .12, .4, 6);
  const faceTex = tex(256, 256, x => {
    x.fillStyle = '#ffd25a'; x.shadowColor = '#ff8a00'; x.shadowBlur = 18;
    for (const sx of [-1, 1]) { x.beginPath(); x.moveTo(128 + sx * 30, 70); x.lineTo(128 + sx * 72, 118); x.lineTo(128 + sx * 18, 118); x.fill(); }
    x.beginPath(); x.moveTo(118, 132); x.lineTo(138, 132); x.lineTo(128, 150); x.fill();
    x.beginPath(); x.moveTo(52, 160); for (let k = 0; k <= 8; k++) x.lineTo(52 + k * 19, k % 2 ? 182 : 160 + (k === 4 ? 6 : 0)); x.quadraticCurveTo(128, 238, 52, 160); x.fill();
  });
  const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const faceGeo = new THREE.PlaneGeometry(1.7, 1.7);
  function lantern(r = 1) {
    const g = new THREE.Group(), body = new THREE.Mesh(pumpGeo, pumpMat), st = new THREE.Mesh(stemGeo, stemMat), face = new THREE.Mesh(faceGeo, faceMat);
    st.position.y = .88; st.rotation.z = .25; face.position.z = 1.06; face.position.y = .02;
    g.add(body, st, face); g.scale.setScalar(r); return g;
  }

  // Bats: body + two flapping wings, in loose flocks circling ahead of the runner
  const batMat = new THREE.MeshBasicMaterial({ color: 0x07030c, side: THREE.DoubleSide });
  const wing = new THREE.Shape(); wing.moveTo(0, 0); wing.lineTo(.5, .32); wing.lineTo(1.05, .18); wing.quadraticCurveTo(.9, .02, .98, -.12); wing.quadraticCurveTo(.75, -.05, .66, -.2); wing.quadraticCurveTo(.5, -.08, .38, -.22); wing.quadraticCurveTo(.24, -.06, 0, -.1);
  const wingGeo = new THREE.ShapeGeometry(wing), batBody = new THREE.SphereGeometry(.16, 8, 6), eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3b1a, toneMapped: false }), eyeGeo = new THREE.SphereGeometry(.03, 4, 3);
  const bats = [];
  for (let i = 0; i < Math.round(34 * density); i++) {
    const b = new THREE.Group(), body = new THREE.Mesh(batBody, batMat); body.scale.set(1, .9, 1.3);
    const l = new THREE.Mesh(wingGeo, batMat), r = new THREE.Mesh(wingGeo, batMat); r.scale.x = -1;
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(eyeGeo, eyeMat); e.position.set(sx * .06, .05, -.15); b.add(e); }
    b.add(body, l, r); b.scale.setScalar(.8 + rnd() * 1.1); group.add(b);
    bats.push({ b, l, r, flock: i % 4, rad: 4 + rnd() * 9, ph: rnd() * 6.28, sp: .7 + rnd() * .6, h: rnd() * 6, flap: 14 + rnd() * 8 });
  }

  // Ghosts: lathe-turned sheet with a wavy hem, dark eyes, cool glow
  const prof = []; for (let k = 0; k <= 14; k++) { const a = k / 14 * Math.PI / 2; prof.push(new THREE.Vector2(Math.sin(a) * .8, 1.6 + Math.cos(a) * .8)); }
  prof.push(new THREE.Vector2(.85, .9), new THREE.Vector2(1, .2), new THREE.Vector2(1.05, 0));
  const ghostGeo = new THREE.LatheGeometry(prof, 32), gp = ghostGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) if (gp.getY(i) < .3) { const a = Math.atan2(gp.getZ(i), gp.getX(i)); gp.setY(i, gp.getY(i) + Math.sin(a * 7) * .16); }
  ghostGeo.computeVertexNormals();
  const ghostMat = new THREE.MeshStandardMaterial({ color: 0xeef2ff, emissive: 0x8fa6ff, emissiveIntensity: .55, transparent: true, opacity: .78, roughness: .4, side: THREE.DoubleSide });
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x05030a }), holeGeo = new THREE.SphereGeometry(.14, 10, 8);
  const ghosts = [];
  for (let i = 0; i < Math.round(12 * density); i++) {
    const g = new THREE.Group(), m = new THREE.Mesh(ghostGeo, ghostMat); g.add(m);
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(holeGeo, holeMat); e.scale.set(1, 1.5, .5); e.position.set(sx * .27, 1.75, .74); g.add(e); }
    const mo = new THREE.Mesh(holeGeo, holeMat); mo.scale.set(1.1, 1.6, .5); mo.position.set(0, 1.3, .8); g.add(mo);
    g.scale.setScalar(1.2 + rnd() * 1.6); group.add(g);
    ghosts.push({ g, side: i % 2 ? 1 : -1, x: 15 + rnd() * 16, z: -i * 22 - rnd() * 10, y: rnd() * 8, ph: rnd() * 6.28 });
  }

  // Graveyard islands: rock slab, tombstones, a dead tree, a lantern, an iron fence
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x1b1622, roughness: 1 }), stoneMat = new THREE.MeshStandardMaterial({ color: 0x5b5866, roughness: .95 });
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x140d10, roughness: 1 }), ironMat = new THREE.MeshBasicMaterial({ color: 0x0a0710 });
  const branch = (g, len, rad, depth) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rad * .6, rad, len, 5), barkMat); m.position.y = len / 2; g.add(m);
    if (!depth) return;
    for (let k = 0; k < 2 + (rnd() < .5); k++) { const c = new THREE.Group(); c.position.y = len * (.55 + rnd() * .4); c.rotation.set((rnd() - .5) * 1.4, rnd() * 6.28, (rnd() < .5 ? -1 : 1) * (.5 + rnd() * .5)); g.add(c); branch(c, len * .62, rad * .6, depth - 1); }
  };
  const islands = [];
  for (let i = 0; i < 18; i++) {
    const g = new THREE.Group(), w = 14 + rnd() * 10, d = 12 + rnd() * 8;
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2.8, 4 + rnd() * 3, 9), rockMat); slab.scale.z = d / w; slab.position.y = -2; g.add(slab);
    for (let k = 0; k < 4; k++) {
      const t = new THREE.Group(), slabT = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, .3), stoneMat), cap = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, .3, 12, 1, false, 0, Math.PI), stoneMat);
      slabT.position.y = .7; cap.rotation.x = Math.PI / 2; cap.rotation.z = Math.PI / 2; cap.position.y = 1.4; t.add(slabT, cap);
      t.position.set((rnd() - .5) * w * .6, 0, (rnd() - .5) * d * .5); t.rotation.set((rnd() - .5) * .25, (rnd() - .5) * .6, (rnd() - .5) * .25); g.add(t);
    }
    if (rnd() < .75) { const tr = new THREE.Group(); tr.position.set((rnd() - .5) * w * .4, 0, -d * .2); branch(tr, 4 + rnd() * 3, .35, 3); g.add(tr); }
    const lan = lantern(.9 + rnd() * .6); lan.position.set((rnd() - .5) * w * .4, .8, d * .25); lan.rotation.y = (rnd() - .5) * .6; g.add(lan);
    for (let k = 0; k < 9; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(.1, 1.6, .1), ironMat); p.position.set(-w * .35 + k * w * .7 / 8, .8, d * .42); g.add(p); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w * .7, .08, .08), ironMat); bar.position.set(0, 1.3, d * .42); g.add(bar);
    const side = i % 2 ? 1 : -1; g.userData.dy = -10 + rnd() * 14; g.position.set(side * (34 + rnd() * 40), g.userData.dy, -i * 29); g.rotation.y = side * -.25;
    group.add(g); islands.push(g);
  }

  // Moon + halo, beyond the fog
  const moon = new THREE.Group();
  const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(38, 32, 20), new THREE.MeshBasicMaterial({ fog: false, toneMapped: false, map: tex(256, 128, x => {
    x.fillStyle = '#fff1c8'; x.fillRect(0, 0, 256, 128);
    for (let k = 0; k < 40; k++) { x.fillStyle = `rgba(190,160,110,${.15 + rnd() * .25})`; x.beginPath(); x.arc(rnd() * 256, rnd() * 128, 3 + rnd() * 14, 0, 7); x.fill(); }
  }) }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: tex(128, 128, x => {
    const g = x.createRadialGradient(64, 64, 10, 64, 64, 64); g.addColorStop(0, 'rgba(255,180,90,.55)'); g.addColorStop(.45, 'rgba(255,120,40,.18)'); g.addColorStop(1, 'rgba(255,90,20,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  }) }));
  halo.scale.setScalar(260); moon.add(halo, moonMesh); group.add(moon);
  // a few bats cross the moon disc, as silhouettes
  const moonBats = []; for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(wingGeo, new THREE.MeshBasicMaterial({ color: 0x07030c, fog: false, side: THREE.DoubleSide })); b.scale.setScalar(5); moon.add(b); moonBats.push({ b, ph: rnd() * 6.28 }); }

  // Ghost-candle face for red candles (two hollow eyes and an O mouth)
  const ghostFace = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, map: tex(128, 128, x => {
    x.fillStyle = '#12040a'; for (const sx of [-1, 1]) { x.beginPath(); x.ellipse(64 + sx * 24, 52, 11, 17, 0, 0, 7); x.fill(); }
    x.beginPath(); x.ellipse(64, 92, 12, 15, 0, 0, 7); x.fill();
  }) });

  // Low graveyard mist: soft purple sheets drifting under the course
  const mistTex = tex(128, 128, x => { for (let k = 0; k < 14; k++) { const cx = 20 + rnd() * 88, cy = 30 + rnd() * 68, r = 18 + rnd() * 30, g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(170,120,255,.22)'); g.addColorStop(1, 'rgba(170,120,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); } });
  const mists = []; for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), new THREE.MeshBasicMaterial({ map: mistTex, transparent: true, depthWrite: false, opacity: .9 })); m.rotation.x = -Math.PI / 2; m.rotation.z = rnd() * 6.28; group.add(m); mists.push({ m, z: -i * 34, dy: -4 - rnd() * 5, sp: (rnd() - .5) * .15 }); }

  // Lightning: a cold flash over the sky every ~9 s (double strike), lighting the scene through the hemisphere light passed in
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xc8b8ff, fog: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, map: halo.material.map }));
  flash.scale.setScalar(900); moon.add(flash);
  const strike = t => { const c = t % 9.3; return c < .08 ? 1 : c > .16 && c < .26 ? .7 : 0; };

  function update(dt, t, cam, light) {
    moon.position.set(cam.x - 140, cam.y + 120, cam.z - 520);
    const f = strike(t); flash.material.opacity = f * .55; if (light) light.intensity = 1.4 + f * 2.2;
    for (const s of mists) { if (s.z - cam.z > 60) s.z -= 340; else if (s.z - cam.z < -280) s.z += 340; s.m.position.set(cam.x, cam.y - 9 + s.dy, s.z); s.m.rotation.z += s.sp * dt; }
    moonBats.forEach((m, k) => { const a = t * .12 + m.ph; m.b.position.set(Math.cos(a) * 60, Math.sin(a * 1.3) * 25, 40); m.b.rotation.z = Math.sin(t * 9 + k) * .5; });
    for (const b of bats) {
      const a = t * b.sp + b.ph, cx = (b.flock - 1.5) * 14, cz = cam.z - 30 - b.flock * 18;
      b.b.position.set(cx + Math.cos(a) * b.rad, cam.y + 4 + b.h + Math.sin(a * 2.3) * 1.5, cz + Math.sin(a) * b.rad);
      b.b.rotation.y = -a; const f = Math.sin(t * b.flap) * .9; b.l.rotation.y = f; b.r.rotation.y = -f;
    }
    for (const h of ghosts) {
      if (h.z - cam.z > 30) h.z -= 264; else if (h.z - cam.z < -234) h.z += 264;
      h.g.position.set(h.side * (h.x + Math.sin(t * .6 + h.ph) * 2), cam.y - 2 + h.y + Math.sin(t * 1.3 + h.ph) * .8, h.z);
      h.g.rotation.y = -h.side * .6 + Math.sin(t * .8 + h.ph) * .3; h.g.rotation.z = Math.sin(t * 1.1 + h.ph) * .08;
    }
    for (const g of islands) { if (g.position.z - cam.z > 60) g.position.z -= 522; else if (g.position.z - cam.z < -462) g.position.z += 522; g.position.y += (cam.y - 8 + g.userData.dy - g.position.y) * Math.min(1, dt * .5); }
    return light ? f : 0; // flash strength, so the game can roll thunder
  }
  // The chasing liquidation fog: four staggered mist sheets that fade out at the top and the edges
  const bankTex = tex(256, 256, x => {
    for (let k = 0; k < 40; k++) { const cx = 20 + rnd() * 216, cy = 120 + rnd() * 136, rr = 30 + rnd() * 60, g = x.createRadialGradient(cx, cy, 0, cx, cy, rr); g.addColorStop(0, 'rgba(150,90,255,.28)'); g.addColorStop(1, 'rgba(150,90,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256); }
    const fade = x.createLinearGradient(0, 0, 0, 256); fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(.55, 'rgba(0,0,0,0)'); x.globalCompositeOperation = 'destination-out'; x.fillStyle = fade; x.fillRect(0, 0, 256, 256);
  });
  function fogBank() {
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(56, 22), new THREE.MeshBasicMaterial({ map: bankTex, transparent: true, depthWrite: false, opacity: .55, side: THREE.DoubleSide })); m.position.set(0, 4 + k * .8, k * 2.2); g.add(m); }
    return g;
  }
  return { group, update, lantern, ghostFace, fogBank };
}
