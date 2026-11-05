import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { StarField } from '../../../../shared/types'
import { starColour } from '../../components/fields'

export interface MapSystem {
  id: string
  name: string
  pos: [number, number, number]
  /** The colour of the polity holding it at the current date. */
  color?: string
}

export interface MapRoute {
  id: string
  color: string
  /** Waypoint positions, ly. */
  points: [number, number, number][]
  /** Drawn brighter (the route being edited). */
  current?: boolean
}

export interface MapNebula {
  id: string
  center: [number, number, number]
  radii: [number, number, number]
  color: string
}

interface Props {
  field: StarField | null
  focus: [number, number, number]
  systems: MapSystem[]
  selected: number | null
  onPick(index: number | null): void
  /** Draw a sphere of this radius (ly) around the focus: the leg limit. */
  reach: number | null
  routes?: MapRoute[]
  nebulae?: MapNebula[]
}

const VERTEX = `
attribute float size;
attribute vec3 tint;
varying vec3 vTint;
void main() {
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(size * 220.0 / -mv.z, 1.6, 26.0);
  gl_Position = projectionMatrix * mv;
}`
const FRAGMENT = `
varying vec3 vTint;
void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.15, d);
  gl_FragColor = vec4(vTint, a);
}`

/**
 * The stars around a focus, in 3D (galactic light-years; z toward the north
 * galactic pole). Drag to orbit, wheel to zoom, right-drag to pan; click a
 * star to pick it. Systems are ringed and labelled. Renders on demand only.
 */
export function StarMap({ field, focus, systems, selected, onPick, reach, routes, nebulae }: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const labels = useRef<HTMLDivElement>(null)
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    stars: THREE.Points | null
    marks: THREE.Group
    render(): void
  } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const latest = useRef({ field, systems, selected, onPick })
  latest.current = { field, systems, selected, onPick }

  // One-time setup.
  useEffect(() => {
    const el = host.current!
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch (err) {
      setFailed(`3D drawing is not available here (${(err as Error).message}).`)
      return
    }
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setClearColor(0x05070c)
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000)
    camera.up.set(0, 0, 1)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    const marks = new THREE.Group()
    scene.add(marks)
    const c = {
      renderer,
      scene,
      camera,
      controls,
      stars: null as THREE.Points | null,
      marks,
      render() {
        renderer.render(scene, camera)
        placeLabels()
      }
    }
    ctx.current = c

    const placeLabels = (): void => {
      const box = labels.current
      if (!box) return
      const { systems: sys, field: f, selected: sel } = latest.current
      const w = el.clientWidth
      const h = el.clientHeight
      const items: { text: string; p: THREE.Vector3; cls: string; color?: string }[] = sys.map((s) => ({
        text: s.name,
        p: new THREE.Vector3(...s.pos),
        cls: 'map-label system',
        color: s.color
      }))
      if (f && sel !== null)
        items.push({
          text: f.names[sel] ?? f.ids[sel],
          p: new THREE.Vector3(f.pos[sel * 3], f.pos[sel * 3 + 1], f.pos[sel * 3 + 2]),
          cls: 'map-label selected'
        })
      if (f) {
        // The brightest named stars, so there is something to steer by.
        const named = Object.keys(f.names)
          .map(Number)
          .sort((a, b) => f.absmag[a] - f.absmag[b])
          .slice(0, 12)
        for (const i of named)
          if (i !== sel)
            items.push({ text: f.names[i], p: new THREE.Vector3(f.pos[i * 3], f.pos[i * 3 + 1], f.pos[i * 3 + 2]), cls: 'map-label' })
      }
      box.replaceChildren(
        ...items
          .map((it) => {
            const v = it.p.clone().project(camera)
            if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return null
            const d = document.createElement('div')
            d.className = it.cls
            d.textContent = it.text
            if (it.color) d.style.color = it.color
            d.style.transform = `translate(${((v.x + 1) / 2) * w + 8}px, ${((1 - v.y) / 2) * h - 8}px)`
            return d
          })
          .filter((d): d is HTMLDivElement => d !== null)
      )
    }

    const resize = (): void => {
      const w = Math.max(10, el.clientWidth)
      const h = Math.max(10, el.clientHeight)
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      c.render()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    controls.addEventListener('change', () => c.render())

    // Click (not drag) to pick.
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent): void => {
      down = { x: e.clientX, y: e.clientY }
    }
    const onUp = (e: PointerEvent): void => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || e.button !== 0) return
      down = null
      const stars = c.stars
      if (!stars) return
      const rect = renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      const ray = new THREE.Raycaster()
      ray.setFromCamera(ndc, camera)
      ray.params.Points = { threshold: camera.position.distanceTo(controls.target) * 0.012 }
      const hits = ray.intersectObject(stars)
      hits.sort((a, b) => (a.distanceToRay ?? 0) - (b.distanceToRay ?? 0))
      latest.current.onPick(hits.length ? (hits[0].index ?? null) : null)
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    resize()
    return () => {
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      el.removeChild(renderer.domElement)
      ctx.current = null
    }
  }, [])

  // The stars.
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    if (c.stars) {
      c.scene.remove(c.stars)
      c.stars.geometry.dispose()
      ;(c.stars.material as THREE.Material).dispose()
      c.stars = null
    }
    if (field && field.ids.length) {
      const n = field.ids.length
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(field.pos, 3))
      const size = new Float32Array(n)
      const tint = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        size[i] = Math.max(0.6, Math.min(5, 3.2 - 0.22 * field.absmag[i]))
        const [r, g, b] = starColour(field.ci[i])
        const dim = field.generated[i] ? 0.75 : 1
        tint.set([r * dim, g * dim, b * dim], i * 3)
      }
      geo.setAttribute('size', new THREE.BufferAttribute(size, 1))
      geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3))
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
      c.stars = new THREE.Points(geo, mat)
      c.scene.add(c.stars)
    }
    c.render()
  }, [field])

  // The camera follows the focus.
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    const target = new THREE.Vector3(...focus)
    const offset = c.camera.position.clone().sub(c.controls.target)
    if (offset.length() < 1e-6) offset.set(-18, -24, 14)
    c.controls.target.copy(target)
    c.camera.position.copy(target.clone().add(offset))
    c.controls.update()
    c.render()
  }, [focus])

  // Marks: system rings, the selection, the line to it, the reach sphere and a plane grid.
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    for (const child of [...c.marks.children]) {
      c.marks.remove(child)
      ;(child as THREE.Mesh).geometry?.dispose()
    }
    const ring = (pos: [number, number, number], colour: number, r: number): THREE.Object3D => {
      const g = new THREE.Points(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)),
        new THREE.PointsMaterial({ color: colour, size: r, sizeAttenuation: false, transparent: true, opacity: 0.55 })
      )
      return g
    }
    for (const s of systems) c.marks.add(ring(s.pos, s.color ? new THREE.Color(s.color).getHex() : 0xe0a43c, 14))
    if (field && selected !== null) {
      const p: [number, number, number] = [field.pos[selected * 3], field.pos[selected * 3 + 1], field.pos[selected * 3 + 2]]
      c.marks.add(ring(p, 0xffffff, 18))
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...focus), new THREE.Vector3(...p)]),
        new THREE.LineBasicMaterial({ color: 0x6aa8ff })
      )
      c.marks.add(line)
    }
    if (reach) {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(reach, 16, 8),
        new THREE.MeshBasicMaterial({ color: 0x6aa8ff, wireframe: true, transparent: true, opacity: 0.035 })
      )
      sphere.position.set(...focus)
      c.marks.add(sphere)
    }
    for (const r of routes ?? []) {
      if (r.points.length < 2) continue
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(r.points.map((p) => new THREE.Vector3(...p))),
        new THREE.LineBasicMaterial({ color: new THREE.Color(r.color), transparent: true, opacity: r.current ? 1 : 0.55 })
      )
      c.marks.add(line)
      if (r.current) c.marks.add(ring(r.points.flat() as unknown as [number, number, number], new THREE.Color(r.color).getHex(), 8))
    }
    for (const n of nebulae ?? []) {
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 12),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(n.color), wireframe: true, transparent: true, opacity: 0.18 })
      )
      shell.scale.set(...n.radii)
      shell.position.set(...n.center)
      c.marks.add(shell)
    }
    const grid = new THREE.PolarGridHelper(50, 8, 5, 64, 0x223044, 0x223044)
    grid.rotation.x = Math.PI / 2
    grid.position.set(focus[0], focus[1], 0)
    c.marks.add(grid)
    c.render()
  }, [systems, selected, field, focus, reach, routes, nebulae])

  return (
    <div className="star-map" ref={host}>
      <div className="map-labels" ref={labels} />
      {failed && <p className="error map-failed">{failed}</p>}
    </div>
  )
}
