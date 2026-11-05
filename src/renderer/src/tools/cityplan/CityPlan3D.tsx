import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Vehicle } from '@malevo/gen'
import type { PlanGeometryDto } from '../../../../shared/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Plan = Record<string, any> & { city: string; extent: number[] }

interface Props {
  plan: Plan
  geo: PlanGeometryDto | null
  cars: Vehicle[]
  /** Radians; azimuth from north toward east. */
  sun: { alt: number; az: number } | null
}

const SURFACE: Record<string, number> = { grass: 0x5d7d4a, mud: 0x7a6a52, paved: 0x6c6c70, sand: 0xc8b080, rock: 0x8a8278 }
const WATER = 0x2c4a66
const LINE: Record<string, number> = {
  street: 0x2a2a2e,
  avenue: 0x202024,
  highway: 0x1c1c20,
  stairs: 0xa09a90,
  lightrail: 0x8a3f3f,
  heavyrail: 0x5a4030,
  fieldline: 0x3f5f8a,
  funicular: 0xb04a2a,
  siding: 0x5a4030,
  seawall: 0x9a948a,
  barrage: 0x6a5040,
  breakwater: 0x8a8680,
  pier: 0x7a6650
}

function disposeGroup(g: THREE.Object3D): void {
  for (const child of [...g.children]) {
    disposeGroup(child)
    const m = child as THREE.Mesh
    m.geometry?.dispose()
    const mat = m.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else mat?.dispose()
    g.remove(child)
  }
}

function polyMesh(poly: number[][], z: number, colour: number): THREE.Mesh | null {
  if (!poly || poly.length < 3) return null
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], p[1])))
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: colour, side: THREE.DoubleSide }))
  m.position.z = z
  return m
}

/** A flat ribbon along a polyline, `w` wide, at height z. */
function ribbon(pts: number[][], w: number, z: number, colour: number): THREE.Mesh | null {
  if (!pts || pts.length < 2) return null
  const pos: number[] = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[i + 1]
    const L = Math.hypot(bx - ax, by - ay) || 1
    const nx = (-(by - ay) / L) * (w / 2)
    const ny = ((bx - ax) / L) * (w / 2)
    const a = [ax + nx, ay + ny, z]
    const b = [ax - nx, ay - ny, z]
    const c = [bx - nx, by - ny, z]
    const d = [bx + nx, by + ny, z]
    pos.push(...a, ...b, ...c, ...a, ...c, ...d)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: colour, side: THREE.DoubleSide }))
}

/**
 * The plan in 3D: the ground and its faces, water, the lines as ribbons,
 * every generated box and the cars running at the moment, lit by the sun at
 * the chosen time. Drag to orbit, wheel to zoom, right-drag to pan. Renders
 * on demand only.
 */
export function CityPlan3D({ plan, geo, cars, sun }: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const ctx = useRef<{
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    world: THREE.Group
    cars: THREE.Group
    sunLight: THREE.DirectionalLight
    ambient: THREE.HemisphereLight
    render(): void
  } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

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
    renderer.setClearColor(0x9ab4cc)
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 50000)
    camera.up.set(0, 0, 1)
    const controls = new OrbitControls(camera, renderer.domElement)
    const world = new THREE.Group()
    const carGroup = new THREE.Group()
    scene.add(world, carGroup)
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.6)
    const ambient = new THREE.HemisphereLight(0xc8d8ff, 0x404030, 0.6)
    scene.add(sunLight, sunLight.target, ambient)
    const c = {
      scene,
      camera,
      controls,
      world,
      cars: carGroup,
      sunLight,
      ambient,
      render: () => renderer.render(scene, camera)
    }
    ctx.current = c
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
    resize()
    return () => {
      ro.disconnect()
      controls.dispose()
      disposeGroup(scene)
      renderer.dispose()
      el.removeChild(renderer.domElement)
      ctx.current = null
    }
  }, [])

  // Frame the extent when the plan's city changes.
  const framed = useRef<string | null>(null)
  useEffect(() => {
    const c = ctx.current
    if (!c || framed.current === plan.city) return
    framed.current = plan.city
    const [x0, y0, x1, y1] = plan.extent
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const span = Math.max(x1 - x0, y1 - y0)
    c.controls.target.set(cx, cy, 0)
    c.camera.position.set(cx + span * 0.1, cy - span * 0.75, span * 0.55)
    c.camera.far = span * 10
    c.camera.updateProjectionMatrix()
    c.controls.update()
    c.render()
  }, [plan])

  // The static scene.
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    disposeGroup(c.world)
    const [x0, y0, x1, y1] = plan.extent
    const gz = plan.defaults?.groundZ ?? 0
    const base = polyMesh(
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1]
      ],
      gz - 0.05,
      SURFACE[plan.defaults?.surface ?? 'grass'] ?? SURFACE.grass
    )
    if (base) c.world.add(base)
    for (const g of plan.ground ?? []) {
      if (g.hidden) continue
      const m = polyMesh(g.poly, g.z ?? gz, SURFACE[g.surface ?? 'grass'] ?? SURFACE.grass)
      if (m) c.world.add(m)
    }
    for (const w of plan.water ?? []) {
      if (w.hidden) continue
      const m = polyMesh(w.poly, (w.z ?? 0) + 0.02, WATER)
      if (m) c.world.add(m)
    }
    for (const l of plan.lines ?? []) {
      if (l.hidden) continue
      const z = (l.z ?? gz) + 0.15
      const m = ribbon(l.pts, l.width ?? (l.kind === 'highway' ? 24 : l.kind === 'avenue' ? 18 : 8), z, LINE[l.kind] ?? 0x303030)
      if (m) c.world.add(m)
    }
    if (geo) {
      // Cliff and terrace faces.
      const pos: number[] = []
      for (const f of geo.faces) {
        const [ax, ay] = f.a
        const [bx, by] = f.b
        pos.push(ax, ay, f.zLo, bx, by, f.zLo, bx, by, f.zHi, ax, ay, f.zLo, bx, by, f.zHi, ax, ay, f.zHi)
      }
      if (pos.length) {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
        g.computeVertexNormals()
        c.world.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x8a8278, side: THREE.DoubleSide })))
      }
      // Boxes.
      const n = geo.boxes.length
      if (n) {
        const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), n)
        const m = new THREE.Matrix4()
        const q = new THREE.Quaternion()
        const zAxis = new THREE.Vector3(0, 0, 1)
        const col = new THREE.Color()
        geo.boxes.forEach((b, i) => {
          q.setFromAxisAngle(zAxis, b.ang)
          m.compose(
            new THREE.Vector3(b.cx, b.cy, (b.z0 + b.z1) / 2),
            q,
            new THREE.Vector3(Math.max(0.1, 2 * b.hw), Math.max(0.1, 2 * b.hd), Math.max(0.1, b.z1 - b.z0))
          )
          mesh.setMatrixAt(i, m)
          if (b.emit) col.setRGB(1, 0.8, 0.5)
          else col.setRGB(b.alb[0] ?? 0.5, b.alb[1] ?? 0.5, b.alb[2] ?? 0.5)
          mesh.setColorAt(i, col)
        })
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        c.world.add(mesh)
      }
    }
    c.render()
  }, [plan, geo])

  // The sun.
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    const [x0, y0, x1, y1] = plan.extent
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const span = Math.max(x1 - x0, y1 - y0)
    const alt = sun?.alt ?? 0.8
    const az = sun?.az ?? 2.4
    const up = Math.sin(alt)
    const day = Math.max(0, Math.min(1, (up + 0.1) / 0.3))
    c.sunLight.target.position.set(cx, cy, 0)
    c.sunLight.position.set(cx + Math.sin(az) * Math.cos(alt) * span, cy + Math.cos(az) * Math.cos(alt) * span, Math.max(0, up) * span)
    c.sunLight.intensity = 2 * day
    c.ambient.intensity = 0.3 + 0.6 * day
    c.render()
  }, [sun, plan])

  // The cars.
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    disposeGroup(c.cars)
    if (cars.length) {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), cars.length)
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      const zAxis = new THREE.Vector3(0, 0, 1)
      const col = new THREE.Color()
      cars.forEach((v, i) => {
        q.setFromAxisAngle(zAxis, v.head)
        m.compose(new THREE.Vector3(v.x, v.y, v.z + v.height / 2), q, new THREE.Vector3(v.length, v.width, v.height))
        mesh.setMatrixAt(i, m)
        mesh.setColorAt(i, col.setRGB(v.colour[0] ?? 0.8, v.colour[1] ?? 0.8, v.colour[2] ?? 0.8))
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      c.cars.add(mesh)
    }
    c.render()
  }, [cars])

  return (
    <div className="plan-3d" ref={host}>
      {failed && <div className="empty">{failed}</div>}
    </div>
  )
}
