(() => {
  const canvas = document.getElementById('hero-particles');
  const header = canvas?.closest('.header');
  const ctx = canvas?.getContext('2d');
  if (!ctx || !header) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = { x: 0, y: 0, active: false };
  const points = Array.from({ length: 58 }, (_, i) => ({ x: Math.random(), y: Math.random(), phase: Math.random() * Math.PI * 2, radius: 1 + Math.random() * 1.3, responsive: i % 3 !== 0, speed: .25 + Math.random() * .3, dx: 0, dy: 0 }));
  // Nearby followers attach locally and return home smoothly as the cursor leaves.
  const followers = Array.from({ length: 34 }, () => ({ x: Math.random(), y: Math.random(), phase: Math.random() * Math.PI * 2, radius: .8 + Math.random() * 1.2, px: null, py: null, attached: false, ease: .018 + Math.random() * .035 }));
  let width = 0, height = 0, frame = 0, visible = true;
  function resize() {
    const rect = header.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
    width = rect.width; height = rect.height;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw(performance.now());
  }
  function draw(time) {
    frame = 0;
    ctx.clearRect(0, 0, width, height);
    const t = reduced.matches ? 0 : time / 1000;
    const positions = points.map(p => {
      const x = p.x * width + Math.cos(t * p.speed + p.phase) * 16;
      const y = p.y * height + Math.sin(t * p.speed + p.phase) * 12;
      const distance = Math.hypot(pointer.x - x, pointer.y - y);
      const force = pointer.active && p.responsive && !reduced.matches ? Math.max(0, 1 - distance / 240) * .26 : 0;
      p.dx += ((pointer.x - x) * force - p.dx) * .045;
      p.dy += ((pointer.y - y) * force - p.dy) * .045;
      return { x: x + p.dx, y: y + p.dy, radius: p.radius, responsive: p.responsive };
    });
    positions.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.responsive ? 'rgba(228,232,238,.38)' : 'rgba(228,232,238,.20)'; ctx.fill();
      for (let j = i + 1; j < positions.length; j++) {
        const q = positions[j], distance = Math.hypot(p.x - q.x, p.y - q.y);
        if (distance > 100) continue;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
        ctx.strokeStyle = `rgba(215,222,232,${.085 * (1 - distance / 100)})`; ctx.lineWidth = .6; ctx.stroke();
      }
    });
    followers.forEach(p => {
      const angle = p.phase + t * .22;
      const homeX = p.x * width + Math.cos(angle) * 12;
      const homeY = p.y * height + Math.sin(angle) * 10;
      const distance = Math.hypot(pointer.x - homeX, pointer.y - homeY);
      if (!pointer.active || reduced.matches || distance > 210) p.attached = false;
      else if (distance < 145) p.attached = true;
      const proximity = p.attached ? Math.max(0, 1 - distance / 210) : 0;
      const force = proximity * proximity * (3 - 2 * proximity) * .72;
      const follow = p.attached;
      const x = homeX + (pointer.x - homeX) * force;
      const y = homeY + (pointer.y - homeY) * force;
      p.px = p.px === null ? x : p.px + (x - p.px) * p.ease;
      p.py = p.py === null ? y : p.py + (y - p.py) * p.ease;
      ctx.beginPath(); ctx.arc(p.px, p.py, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = follow ? 'rgba(224,233,246,.46)' : 'rgba(224,233,246,.24)'; ctx.fill();
    });
    if (!reduced.matches && visible && !document.hidden) frame = requestAnimationFrame(draw);
  }
  function restart() { if (frame) cancelAnimationFrame(frame); frame = 0; draw(performance.now()); }
  header.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    const rect = header.getBoundingClientRect(); pointer.x = event.clientX - rect.left; pointer.y = event.clientY - rect.top; pointer.active = true;
  });
  header.addEventListener('pointerleave', () => { pointer.active = false; });
  new ResizeObserver(() => { if (frame) cancelAnimationFrame(frame); resize(); }).observe(header);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; restart(); }).observe(header);
  document.addEventListener('visibilitychange', restart);
  reduced.addEventListener('change', restart);
})();

// Scroll choreography is independent of WebGL and never moves the layout itself.
(() => {
  const header = document.querySelector('.header');
  if (!header) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0, current = 0, target = 0;
  function paint() {
    frame = 0;
    current += (target - current) * (document.hidden ? 1 : .13);
    const progress = reduced.matches ? 0 : current;
    const exit = Math.min(1, progress / .82);
    const fade = exit * exit * (3 - 2 * exit);
    header.style.setProperty('--hero-visibility', (1 - fade).toFixed(4));
    header.style.setProperty('--hero-blur', (fade * 1.8).toFixed(2) + 'px');
    header.style.setProperty('--hero-light-y', (progress * 52).toFixed(2) + 'px');
    header.style.setProperty('--hero-light-scale', (1 + progress * .07).toFixed(4));
    header.style.setProperty('--hero-light-opacity', (1 - progress * .24).toFixed(4));
    header.style.setProperty('--hero-title-y', (-progress * 22).toFixed(2) + 'px');
    header.style.setProperty('--hero-status-y', (-progress * 14).toFixed(2) + 'px');
    header.style.setProperty('--hero-title-opacity', (1 - progress * .55).toFixed(4));
    if (Math.abs(target - current) > .0005 && !document.hidden) frame = requestAnimationFrame(paint);
  }
  function update() {
    const rect = header.getBoundingClientRect();
    target = Math.max(0, Math.min(1, -rect.top / Math.max(1, rect.height)));
    if (reduced.matches) current = target;
    if (!frame) frame = requestAnimationFrame(paint);
  }
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  document.addEventListener('visibilitychange', update);
  reduced.addEventListener('change', update);
  update();
})();
