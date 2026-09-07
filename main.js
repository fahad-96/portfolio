/* ============================================================
   Fahad Yousuf, portfolio behaviour
   - Three.js morphing particle sphere on one fixed canvas
   - GSAP ScrollTrigger drives the sphere along a scroll path
   - Lenis adds inertia to scrolling
   The sphere begins life as an aura behind the hero portrait,
   then lifts off the photo on the first scroll and travels
   through the sections.
============================================================ */
import * as THREE from 'three';

const html = document.documentElement;

try {
    gsap.registerPlugin(ScrollTrigger);

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = matchMedia('(pointer: fine)').matches;
    const isSmall = () => innerWidth <= 900;

    if (!reduced) html.classList.add('anim');

    /* ---------- smooth scroll ---------- */
    let lenis = null;
    if (!reduced && typeof Lenis !== 'undefined') {
        lenis = new Lenis({
            duration: 1.15,
            easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t))
        });
        lenis.on('scroll', ScrollTrigger.update);
        gsap.ticker.add(t => lenis.raf(t * 1000));
        gsap.ticker.lagSmoothing(0);
    }

    /* ---------- split headings into characters ---------- */
    function splitChars(el) {
        const text = el.textContent;
        el.setAttribute('aria-label', text);
        el.textContent = '';
        const frag = document.createDocumentFragment();
        [...text].forEach(c => {
            const s = document.createElement('span');
            s.className = 'ch';
            s.setAttribute('aria-hidden', 'true');
            s.textContent = c === ' ' ? ' ' : c;
            frag.appendChild(s);
        });
        el.appendChild(frag);
        return el.querySelectorAll('.ch');
    }

    document.querySelectorAll('[data-chars]').forEach(splitChars);
    if (!reduced) {
        gsap.set('.hero-name .ch', { yPercent: 115 });
    }

    /* ============================================================
       Three.js scene
       The state object "tgt" is the look we want; "cur" eases
       toward it every frame so scroll changes feel fluid.
       The hero state places the sphere over the portrait on the
       right; the first scroll segment grows it and sweeps it left,
       which reads as the sphere emerging from the photo.
    ============================================================ */
    let glOK = false;
    // `reveal` is the aura ball's own visibility (0 = hidden behind the
    // portrait on the hero, 1 = out and visible). It is separate from `op`,
    // which fades the whole scene in after the preloader, so the ambient
    // starfield can be present on the hero while the ball stays hidden.
    const cur = { amp: .55, scale: .58, x: 1.7, y: 0, rotY: 0, op: 0, dim: 1, mix: .25, camZ: 5.2, reveal: 0 };
    const tgt = { ...cur };
    const mouse = { x: 0, y: 0, cx: 0, cy: 0 };

    (function initGL() {
        const canvas = document.getElementById('gl');
        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({
                canvas, antialias: false, alpha: false,
                powerPreference: 'high-performance'
            });
        } catch (e) {
            canvas.style.display = 'none';
            return;
        }
        renderer.setClearColor(0x050505, 1);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .1, 60);

        const mobileGPU = isSmall();
        const sharedTime = { value: 0 };

        /* ---------- morphing particle core ---------- */
        const coreGeo = new THREE.IcosahedronGeometry(1.1, mobileGPU ? 22 : 60);
        coreGeo.setIndex(null); // unique verts only, Points needs no index

        const coreMat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uTime: sharedTime,
                uAmp: { value: cur.amp },
                uScale: { value: cur.scale },
                uSize: { value: (mobileGPU ? 2.1 : 2.3) * Math.min(devicePixelRatio || 1, 2) },
                uOpacity: { value: 0 },
                uMix: { value: cur.mix },
                uColA: { value: new THREE.Color('#5d5a68') },
                uColB: { value: new THREE.Color('#8a7cff') }
            },
            vertexShader: `
                uniform float uTime, uAmp, uScale, uSize;
                varying float vN;
                float wave(vec3 p, float t){
                    return sin(p.x*1.6 + t*.7) * sin(p.y*1.4 - t*.6) * sin(p.z*1.8 + t*.5);
                }
                void main(){
                    float t = uTime;
                    float n = wave(position, t) * .6
                            + wave(position*2.3 + 4.7, t*1.6) * .3
                            + wave(position*4.9 + 9.2, t*2.2) * .12;
                    vN = n;
                    vec3 pos = position + normal * n * uAmp;
                    vec4 mv = modelViewMatrix * vec4(pos * uScale, 1.0);
                    gl_PointSize = uSize * (1.0 + vN * .55) * (5.0 / -mv.z);
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: `
                uniform float uOpacity, uMix;
                uniform vec3 uColA, uColB;
                varying float vN;
                void main(){
                    float d = length(gl_PointCoord - .5);
                    if (d > .5) discard;
                    float a = smoothstep(.5, .08, d);
                    vec3 col = mix(uColA, uColB, clamp(vN * .7 + .5, 0.0, 1.0));
                    col = mix(col, uColB, uMix * .5);
                    gl_FragColor = vec4(col, a * uOpacity);
                }`
        });
        const core = new THREE.Points(coreGeo, coreMat);
        scene.add(core);

        /* ---------- ambient starfield ---------- */
        const starCount = mobileGPU ? 420 : 1300;
        const sPos = new Float32Array(starCount * 3);
        const sRnd = new Float32Array(starCount);
        for (let i = 0; i < starCount; i++) {
            const v = new THREE.Vector3().randomDirection()
                .multiplyScalar(4.5 + Math.random() * 9);
            sPos.set([v.x, v.y, v.z], i * 3);
            sRnd[i] = Math.random();
        }
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
        starGeo.setAttribute('aRnd', new THREE.BufferAttribute(sRnd, 1));

        const starMat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uTime: sharedTime,
                uSize: { value: 1.9 * Math.min(devicePixelRatio || 1, 2) },
                uOpacity: { value: 0 },
                uAccent: { value: new THREE.Color('#8a7cff') }
            },
            vertexShader: `
                uniform float uSize;
                attribute float aRnd;
                varying float vR;
                void main(){
                    vR = aRnd;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = uSize * (.55 + aRnd * .8) * (5.0 / -mv.z);
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: `
                uniform float uTime, uOpacity;
                uniform vec3 uAccent;
                varying float vR;
                void main(){
                    float d = length(gl_PointCoord - .5);
                    if (d > .5) discard;
                    float a = smoothstep(.5, .1, d);
                    float tw = .55 + .45 * sin(uTime * (1.0 + vR * 2.0) + vR * 60.0);
                    vec3 col = mix(vec3(.62), uAccent, step(.85, vR) * .65);
                    gl_FragColor = vec4(col, a * tw * uOpacity * .8);
                }`
        });
        const stars = new THREE.Points(starGeo, starMat);
        scene.add(stars);

        /* ---------- sizing (guards mobile address-bar resize thrash) ---------- */
        let lastW = 0, lastH = 0;
        function size(force) {
            const w = innerWidth, h = innerHeight;
            if (!force && w === lastW && Math.abs(h - lastH) < 160) return;
            lastW = w; lastH = h;
            renderer.setPixelRatio(Math.min(devicePixelRatio || 1, w <= 900 ? 1.75 : 2));
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
        size(true);
        addEventListener('resize', () => size(false));

        /* ---------- mouse parallax (desktop only) ---------- */
        if (finePointer && !reduced) {
            addEventListener('pointermove', e => {
                mouse.x = (e.clientX / innerWidth - .5) * 2;
                mouse.y = (e.clientY / innerHeight - .5) * 2;
            }, { passive: true });
        }

        /* ---------- render loop, driven by GSAP's ticker ---------- */
        const clock = new THREE.Clock();
        const lerp = (a, b, f) => a + (b - a) * f;
        let time = 0;

        gsap.ticker.add(() => {
            if (document.hidden) return;
            time += clock.getDelta() * (reduced ? .12 : 1);
            sharedTime.value = time;

            for (const k in cur) cur[k] = lerp(cur[k], tgt[k], .055);
            mouse.cx = lerp(mouse.cx, mouse.x, .045);
            mouse.cy = lerp(mouse.cy, mouse.y, .045);

            coreMat.uniforms.uAmp.value = cur.amp;
            coreMat.uniforms.uScale.value = cur.scale;
            coreMat.uniforms.uOpacity.value = cur.op * cur.dim * cur.reveal;
            coreMat.uniforms.uMix.value = cur.mix;
            starMat.uniforms.uOpacity.value = cur.op * (.55 + cur.dim * .45);

            core.position.set(cur.x, cur.y + Math.sin(time * .5) * .06, 0);
            core.rotation.y = cur.rotY + time * .1;
            core.rotation.x = Math.sin(time * .28) * .08;
            stars.rotation.y = time * .016;

            camera.position.set(mouse.cx * .45, -mouse.cy * .28, cur.camZ);
            camera.lookAt(0, 0, 0);
            renderer.render(scene, camera);
        });

        glOK = true;
    })();

    /* ============================================================
       Scroll choreography for the 3D scene.
       gsap.matchMedia rebuilds the timeline cleanly when crossing
       the mobile breakpoint. Each segment is one journey beat.
    ============================================================ */
    // The journey is a list of keyframe states sampled from one scroll
    // progress value (0 at the top of the page, 1 at the bottom). Keeping it
    // as plain data, rather than a GSAP timeline that mutates `tgt`, means a
    // breakpoint change is just "rebuild the keyframes and re-sample": there
    // is no timeline to revert and nothing to clobber the freshly set values.
    // `m` is true on small screens.
    const SEG = [0.8, 0.9, 1, 1, 0.7, 1]; // relative length of each beat
    const STOPS = (() => {
        const total = SEG.reduce((a, b) => a + b, 0);
        const out = [0];
        let acc = 0;
        SEG.forEach(s => { acc += s; out.push(acc / total); });
        return out; // 7 entries, 0 .. 1
    })();
    const PROPS = ['x', 'y', 'scale', 'amp', 'dim', 'mix', 'rotY', 'camZ'];

    function keyframes(m) {
        const z = m ? 6.6 : 5.2;
        return [
            // hero: an aura cradled behind the portrait
            { x: m ? 0 : 2.45, y: m ? .95 : 0, scale: m ? .5 : .62, amp: m ? .5 : .6, dim: 1, mix: .25, rotY: 0, camZ: z },
            // about: lifted off the photo, grown, swept across
            { x: m ? 0 : -1.35, y: 0, scale: m ? .92 : 1, amp: .7, dim: 1, mix: .25, rotY: 1.9, camZ: z },
            // experience: tucked into the empty left column, small and faint
            // so the role descriptions stay readable
            { x: m ? 0 : -2.7, y: m ? 1.15 : .25, scale: m ? .5 : .68, amp: .38, dim: m ? .3 : .5, mix: .25, rotY: 2.7, camZ: z + .3 },
            // work: swelled behind the cards, dimmed back (further on phones,
            // where it sits directly under the copy)
            { x: 0, y: 0, scale: m ? 1.3 : 1.55, amp: .95, dim: m ? .3 : .45, mix: .25, rotY: 3.4, camZ: z + .8 },
            // skills: condensed tight, tucked at the right edge
            { x: m ? 0 : 2.95, y: m ? .95 : -.15, scale: m ? .6 : .58, amp: .13, dim: 1, mix: .25, rotY: 5, camZ: z },
            // resume: a calm breath, still resting right
            { x: m ? 0 : 2.4, y: 0, scale: .92, amp: .32, dim: 1, mix: .25, rotY: 5.8, camZ: z },
            // contact: reformed at centre, warm violet
            { x: 0, y: m ? .2 : 0, scale: 1.18, amp: .55, dim: 1, mix: .85, rotY: 7, camZ: z - .35 }
        ];
    }

    let keysSmall = isSmall();
    let keys = keyframes(keysSmall);
    let journeyP = 0;

    function sampleJourney() {
        // Self-correct the breakpoint on every sample. If the width was wrong
        // at module init (some browsers report the desktop size for a frame
        // before applying the real one) or it changes later, we rebuild the
        // keyframes here so we can never get pinned to the other layout.
        const s = isSmall();
        if (s !== keysSmall) { keysSmall = s; keys = keyframes(s); }

        let i = 0;
        while (i < STOPS.length - 2 && journeyP > STOPS[i + 1]) i++;
        const span = STOPS[i + 1] - STOPS[i] || 1;
        const t = Math.min(1, Math.max(0, (journeyP - STOPS[i]) / span));
        const a = keys[i], b = keys[i + 1];
        for (const k of PROPS) tgt[k] = a[k] + (b[k] - a[k]) * t; // op stays untouched
    }

    if (glOK) {
        Object.assign(tgt, keys[0]); // best guess for the very first frame

        if (!reduced) {
            ScrollTrigger.create({
                trigger: document.body, start: 'top top', end: 'bottom bottom',
                onUpdate: self => { journeyP = self.progress; sampleJourney(); },
                onRefresh: self => { journeyP = self.progress; sampleJourney(); }
            });
            // keep the ball hidden behind the portrait on the hero, then fade
            // it in as the hero scrolls away so it appears to emerge from the photo
            ScrollTrigger.create({
                trigger: '.hero', start: 'top top', end: 'bottom top',
                onUpdate: self => { tgt.reveal = self.progress; },
                onRefresh: self => { tgt.reveal = self.progress; }
            });
            addEventListener('resize', sampleJourney, { passive: true });
            // re-sample the instant the breakpoint flips (more reliable than
            // resize for catching a width that settles just after load)
            matchMedia('(max-width: 900px)').addEventListener('change', sampleJourney);
        } else {
            tgt.reveal = 1; // static scene: just show the ball
        }
    }

    /* ============================================================
       Preloader, then the hero intro
    ============================================================ */
    const loader = document.getElementById('loader');
    const count = document.getElementById('loadCount');
    loader.dataset.bound = '1';

    function heroIntro() {
        tgt.op = 1;
        if (reduced) return;
        gsap.timeline({ defaults: { ease: 'power3.out' } })
            .to('.hero-name .ch', { yPercent: 0, duration: 1.15, stagger: .04 }, 0)
            .fromTo('.hero-role, .hero-tag, .hero-cta', { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: .9, stagger: .1 }, .55)
            .fromTo('.profile-card', { autoAlpha: 0, scale: .86 }, { autoAlpha: 1, scale: 1, duration: 1.1 }, .5)
            .fromTo('.hero-foot > *', { autoAlpha: 0 }, { autoAlpha: 1, duration: .9, stagger: .12 }, .85)
            .fromTo('.site-head', { autoAlpha: 0, y: -14 }, { autoAlpha: 1, y: 0, duration: .8 }, .7);
    }

    const pageReady = new Promise(r => {
        if (document.readyState === 'complete') r();
        else addEventListener('load', r, { once: true });
    });
    const num = { v: 0 };
    const draw = () => count.textContent = String(Math.round(num.v)).padStart(3, '0');
    if (!reduced) gsap.to(num, { v: 99, duration: 1.6, ease: 'power2.inOut', onUpdate: draw });

    Promise.race([
        Promise.all([pageReady, new Promise(r => setTimeout(r, reduced ? 0 : 600))]),
        new Promise(r => setTimeout(r, 5000))
    ]).then(() => {
        ScrollTrigger.refresh();
        sampleJourney(); // lock in the correct layout once width has settled
        if (reduced) {
            loader.style.display = 'none';
            heroIntro();
            return;
        }
        gsap.timeline()
            .to(num, { v: 100, duration: .25, ease: 'power1.out', onUpdate: draw })
            .to('.loader-inner', { yPercent: -36, autoAlpha: 0, duration: .45, ease: 'power2.in' })
            .to(loader, {
                yPercent: -100, duration: .9, ease: 'power4.inOut',
                onComplete: () => loader.style.display = 'none'
            }, '-=.12')
            .add(heroIntro, '-=.55');
    });

    /* ============================================================
       DOM scroll effects
    ============================================================ */
    if (!reduced) {
        // hero text recedes as you leave it
        gsap.to('.hero-text', {
            yPercent: -14, autoAlpha: 0, ease: 'none',
            scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom 30%', scrub: true }
        });

        // portrait fades and shrinks so the sphere appears to take over
        gsap.to('.hero-portrait', {
            autoAlpha: 0, scale: .9, ease: 'none',
            scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom 45%', scrub: true }
        });

        // section titles rise behind their mask
        document.querySelectorAll('.sec-head h2').forEach(h => {
            const chars = h.querySelectorAll('.ch');
            gsap.set(chars, { yPercent: 115 });
            gsap.to(chars, {
                yPercent: 0, duration: .9, ease: 'power4.out', stagger: .035,
                scrollTrigger: { trigger: h, start: 'top 86%', once: true }
            });
        });

        // generic fade-ups
        gsap.utils.toArray('[data-fade]').forEach(el => {
            gsap.fromTo(el, { y: 36, autoAlpha: 0 }, {
                y: 0, autoAlpha: 1, duration: 1, ease: 'power3.out',
                scrollTrigger: { trigger: el, start: 'top 88%', once: true }
            });
        });

        // gentle parallax on project imagery
        gsap.utils.toArray('.pwrap img').forEach(img => {
            gsap.fromTo(img, { yPercent: -8 }, {
                yPercent: 8, ease: 'none',
                scrollTrigger: {
                    trigger: img.closest('.work-row'),
                    start: 'top bottom', end: 'bottom top', scrub: true
                }
            });
        });

        // top hairline progress bar
        gsap.to('.progress', {
            scaleX: 1, ease: 'none',
            scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: .4 }
        });
    }

    /* ---------- section indicator (kept hidden over the hero) ---------- */
    const secNow = document.getElementById('secNow');
    const pageMeta = document.querySelector('.page-meta');
    ScrollTrigger.create({
        trigger: '.hero', start: 'bottom 75%',
        onEnter: () => pageMeta.classList.add('show'),
        onLeaveBack: () => pageMeta.classList.remove('show')
    });
    ['#about', '#experience', '#work', '#skills', '#resume', '#contact'].forEach((id, i) => {
        ScrollTrigger.create({
            trigger: id, start: 'top center', end: 'bottom center',
            onToggle: s => { if (s.isActive) secNow.textContent = String(i + 1).padStart(2, '0'); }
        });
    });

    /* ============================================================
       Rotating role label in the hero
    ============================================================ */
    const roleEl = document.getElementById('role');
    if (!reduced && roleEl) {
        const roles = ['LLM Trainer | RLHF', 'Software Engineer', 'Web Developer', 'UI / UX Designer'];
        let ri = 0;
        (function cycle() {
            gsap.timeline({ onComplete: cycle })
                .to(roleEl, { yPercent: -110, autoAlpha: 0, duration: .45, ease: 'power2.in', delay: 2.6 })
                .add(() => {
                    ri = (ri + 1) % roles.length;
                    roleEl.textContent = roles[ri];
                    gsap.set(roleEl, { yPercent: 110 });
                })
                .to(roleEl, { yPercent: 0, autoAlpha: 1, duration: .55, ease: 'power3.out' });
        })();
    }

    /* ============================================================
       Mobile fullscreen menu
    ============================================================ */
    const menuBtn = document.getElementById('menuBtn');
    const menu = document.getElementById('menu');
    function setMenu(open) {
        html.classList.toggle('menu-open', open);
        menuBtn.textContent = open ? 'Close' : 'Menu';
        menuBtn.setAttribute('aria-expanded', open);
        menu.setAttribute('aria-hidden', !open);
        if (lenis) open ? lenis.stop() : lenis.start();
        document.body.style.overflow = open ? 'hidden' : '';
    }
    menuBtn.addEventListener('click', () => setMenu(!html.classList.contains('menu-open')));

    /* ============================================================
       Anchor links, routed through Lenis when available
    ============================================================ */
    document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', e => {
            const id = a.getAttribute('href');
            if (id.length < 2) return;
            const target = document.querySelector(id);
            if (!target) return;
            e.preventDefault();
            setMenu(false);
            if (lenis) lenis.scrollTo(target, { offset: 0, duration: 1.4 });
            else target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
        });
    });

    /* ============================================================
       Custom cursor
    ============================================================ */
    if (finePointer && !reduced) {
        html.classList.add('has-cursor');
        const dot = document.querySelector('.cursor-dot');
        const ring = document.querySelector('.cursor-ring');
        let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y;
        addEventListener('pointermove', e => {
            x = e.clientX; y = e.clientY;
            dot.style.transform = `translate(${x}px, ${y}px)`;
        }, { passive: true });
        gsap.ticker.add(() => {
            rx += (x - rx) * .14;
            ry += (y - ry) * .14;
            ring.style.transform = `translate(${rx}px, ${ry}px)`;
        });
        document.querySelectorAll('a, button').forEach(el => {
            el.addEventListener('mouseenter', () => ring.classList.add('on'));
            el.addEventListener('mouseleave', () => ring.classList.remove('on'));
        });
    }

    /* ============================================================
       Local clock in the footer (IST)
    ============================================================ */
    const clockEl = document.getElementById('clock');
    if (clockEl) {
        const fmt = new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            timeZone: 'Asia/Kolkata'
        });
        const tick = () => clockEl.textContent = fmt.format(new Date());
        tick();
        setInterval(tick, 1000);
    }

} catch (err) {
    // Fail open: drop the animation prep so content is never stuck hidden.
    html.classList.remove('anim');
    const l = document.getElementById('loader');
    if (l) l.style.display = 'none';
    console.error('Init failed, running static fallback:', err);
}
