import * as THREE from 'three'

/**
 * 两点测量：在模型表面点两下，画一条线并显示距离。
 * 标记和线放在场景里，文字标签是一个绝对定位的 HTML 元素，
 * 每次渲染后按投影位置刷新。
 */
export class MeasureTool {
  readonly group = new THREE.Group()
  readonly points: THREE.Vector3[] = []
  private markers: THREE.Mesh[] = []
  private line: THREE.Line | null = null
  private label: HTMLDivElement
  private markerGeo = new THREE.SphereGeometry(1, 16, 12)
  private markerMat = new THREE.MeshBasicMaterial({ color: 0xff5f8a, depthTest: false, transparent: true })
  private lineMat = new THREE.LineBasicMaterial({ color: 0xff5f8a, depthTest: false, transparent: true })
  private raycaster = new THREE.Raycaster()
  private size = 0.01

  onChange: ((distance: number | null, points: THREE.Vector3[]) => void) | null = null

  constructor(private host: HTMLElement) {
    this.group.name = '__measure'
    this.group.renderOrder = 999
    this.label = document.createElement('div')
    this.label.className = 'measure-label'
    this.label.hidden = true
    host.appendChild(this.label)
  }

  /** 按模型尺度设定标记大小 */
  setScale(radius: number): void {
    this.size = Math.max(radius * 0.008, 1e-5)
    for (const m of this.markers) m.scale.setScalar(this.size)
    this.raycaster.params.Points = { threshold: radius * 0.01 }
    this.raycaster.params.Line = { threshold: radius * 0.01 }
  }

  /** 在 NDC 坐标处拾取模型表面；命中则加一个点（第三次点击重新开始） */
  pick(ndc: THREE.Vector2, camera: THREE.Camera, target: THREE.Object3D): boolean {
    this.raycaster.setFromCamera(ndc, camera)
    const hits = this.raycaster
      .intersectObject(target, true)
      .filter((h) => !h.object.name.startsWith('__') && h.object.visible)
    if (hits.length === 0) return false
    if (this.points.length >= 2) this.clear(false)
    this.add(hits[0].point.clone())
    return true
  }

  private add(p: THREE.Vector3): void {
    this.points.push(p)
    const m = new THREE.Mesh(this.markerGeo, this.markerMat)
    m.position.copy(p)
    m.scale.setScalar(this.size)
    m.renderOrder = 999
    m.name = '__measure_marker'
    this.group.add(m)
    this.markers.push(m)
    if (this.points.length === 2) {
      const geo = new THREE.BufferGeometry().setFromPoints(this.points)
      this.line = new THREE.Line(geo, this.lineMat)
      this.line.renderOrder = 999
      this.line.name = '__measure_line'
      this.group.add(this.line)
    }
    this.onChange?.(this.distance(), this.points)
  }

  distance(): number | null {
    return this.points.length === 2 ? this.points[0].distanceTo(this.points[1]) : null
  }

  clear(notify = true): void {
    for (const m of this.markers) this.group.remove(m)
    this.markers = []
    if (this.line) {
      this.group.remove(this.line)
      this.line.geometry.dispose()
      this.line = null
    }
    this.points.length = 0
    this.label.hidden = true
    if (notify) this.onChange?.(null, this.points)
  }

  /** 渲染后调用：把标签摆到线段中点的屏幕位置 */
  updateLabel(camera: THREE.Camera, width: number, height: number, unitScale = 1, unitName = ''): void {
    const d = this.distance()
    if (d === null) {
      // 只有一个点时也给个提示
      if (this.points.length === 1) {
        const p = this.points[0].clone().project(camera)
        this.place(p, width, height, '再点一个点')
      } else this.label.hidden = true
      return
    }
    const mid = new THREE.Vector3().addVectors(this.points[0], this.points[1]).multiplyScalar(0.5).project(camera)
    const v = d * unitScale
    const txt = v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toFixed(5)
    this.place(mid, width, height, `${txt}${unitName ? ' ' + unitName : ''}`)
  }

  private place(p: THREE.Vector3, width: number, height: number, text: string): void {
    if (p.z > 1) {
      this.label.hidden = true
      return
    }
    this.label.hidden = false
    this.label.textContent = text
    this.label.style.left = `${((p.x + 1) / 2) * width}px`
    this.label.style.top = `${((1 - p.y) / 2) * height}px`
  }

  setVisible(v: boolean): void {
    this.group.visible = v
    if (!v) this.label.hidden = true
  }

  dispose(): void {
    this.clear(false)
    this.markerGeo.dispose()
    this.markerMat.dispose()
    this.lineMat.dispose()
    this.label.remove()
  }
}
