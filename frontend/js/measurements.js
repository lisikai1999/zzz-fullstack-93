const Measurements = {
    polygonArea(coords) {
        const n = coords.length;
        if (n < 3) return 0;
        let area = 0;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += coords[i][0] * coords[j][1];
            area -= coords[j][0] * coords[i][1];
        }
        return Math.abs(area) / 2;
    },

    polygonPerimeter(coords) {
        const n = coords.length;
        if (n < 2) return 0;
        let total = 0;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const dx = coords[j][0] - coords[i][0];
            const dy = coords[j][1] - coords[i][1];
            total += Math.sqrt(dx * dx + dy * dy);
        }
        return total;
    },

    lineLength(p1, p2) {
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        return Math.sqrt(dx * dx + dy * dy);
    },

    equivalentDiameter(areaUm2) {
        if (areaUm2 <= 0) return 0;
        return 2 * Math.sqrt(areaUm2 / Math.PI);
    },

    convexHull(points) {
        const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        if (pts.length <= 2) return pts;

        const cross = (o, a, b) =>
            (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

        const lower = [];
        for (const p of pts) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
                lower.pop();
            lower.push(p);
        }
        const upper = [];
        for (let i = pts.length - 1; i >= 0; i--) {
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0)
                upper.pop();
            upper.push(pts[i]);
        }
        return lower.slice(0, -1).concat(upper.slice(0, -1));
    },

    maxFeretDiameter(coords) {
        const hull = this.convexHull(coords);
        if (hull.length < 2) return 0;
        let maxD = 0;
        for (let i = 0; i < hull.length; i++) {
            for (let j = i + 1; j < hull.length; j++) {
                const dx = hull[j][0] - hull[i][0];
                const dy = hull[j][1] - hull[i][1];
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d > maxD) maxD = d;
            }
        }
        return maxD;
    },

    minFeretDiameter(coords) {
        const hull = this.convexHull(coords);
        const n = hull.length;
        if (n < 3) return 0;

        let minW = Infinity;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            let ex = hull[j][0] - hull[i][0];
            let ey = hull[j][1] - hull[i][1];
            const edgeLen = Math.sqrt(ex * ex + ey * ey);
            if (edgeLen === 0) continue;
            const nx = -ey / edgeLen;
            const ny = ex / edgeLen;

            let minProj = Infinity, maxProj = -Infinity;
            for (let k = 0; k < n; k++) {
                const proj = hull[k][0] * nx + hull[k][1] * ny;
                if (proj < minProj) minProj = proj;
                if (proj > maxProj) maxProj = proj;
            }
            const width = maxProj - minProj;
            if (width < minW) minW = width;
        }
        return minW === Infinity ? 0 : minW;
    },

    compactness(area, perimeter) {
        if (perimeter <= 0) return 0;
        return (4 * Math.PI * area) / (perimeter * perimeter);
    },

    solidity(area, convexArea) {
        if (convexArea <= 0) return 0;
        return area / convexArea;
    },

    compute(geometry, toolType, umPerPixel) {
        const coords = geometry.coordinates || [];
        const result = {};

        if (toolType === 'line') {
            if (coords.length >= 2) {
                result.length_px = this.lineLength(coords[0], coords[1]);
                if (umPerPixel) {
                    result.length_um = result.length_px * umPerPixel;
                }
            }
            return result;
        }

        if (coords.length < 3) return result;

        const area = this.polygonArea(coords);
        const perimeter = this.polygonPerimeter(coords);
        const feretMax = this.maxFeretDiameter(coords);
        const feretMin = this.minFeretDiameter(coords);
        const hull = this.convexHull(coords);
        const convexArea = this.polygonArea(hull);

        result.area_px = area;
        result.perimeter_px = perimeter;
        result.max_feret_px = feretMax;
        result.min_feret_px = feretMin;
        result.compactness = this.compactness(area, perimeter);
        result.solidity = this.solidity(area, convexArea);
        result.convex_area_px = convexArea;

        if (umPerPixel) {
            result.area_um2 = area * (umPerPixel * umPerPixel);
            result.perimeter_um = perimeter * umPerPixel;
            result.equiv_diameter_um = this.equivalentDiameter(result.area_um2);
            result.max_feret_um = feretMax * umPerPixel;
            result.min_feret_um = feretMin * umPerPixel;
        }

        return result;
    },

    formatDisplay(measurement, toolType) {
        const el = document.getElementById('measurement-display');
        if (!measurement) {
            el.innerHTML = '<p class="placeholder">完成标注后显示测量数据</p>';
            return;
        }

        let html = '';

        if (toolType === 'line') {
            html += this._row('长度(px)', this._fmt(measurement.length_px, 1));
            if (measurement.length_um != null) {
                html += this._row('长度(µm)', this._fmt(measurement.length_um, 2));
                html += this._row('长度(mm)', this._fmt(measurement.length_um / 1000, 4));
            }
        } else {
            html += this._row('面积(px²)', this._fmtInt(measurement.area_px));
            if (measurement.area_um2 != null) {
                html += this._row('面积(µm²)', this._fmtInt(measurement.area_um2));
                html += this._row('面积(mm²)', this._fmt(measurement.area_um2 / 1e6, 4));
            }
            html += this._row('周长(px)', this._fmt(measurement.perimeter_px, 1));
            if (measurement.perimeter_um != null) {
                html += this._row('周长(µm)', this._fmt(measurement.perimeter_um, 1));
            }
            if (measurement.equiv_diameter_um != null) {
                html += this._row('等效直径(µm)', this._fmt(measurement.equiv_diameter_um, 2));
            }
            if (measurement.max_feret_um != null) {
                html += this._row('最大费雷特(µm)', this._fmt(measurement.max_feret_um, 2));
            } else if (measurement.max_feret_px != null) {
                html += this._row('最大费雷特(px)', this._fmt(measurement.max_feret_px, 1));
            }
            if (measurement.min_feret_um != null) {
                html += this._row('最小费雷特(µm)', this._fmt(measurement.min_feret_um, 2));
            } else if (measurement.min_feret_px != null) {
                html += this._row('最小费雷特(px)', this._fmt(measurement.min_feret_px, 1));
            }
            if (measurement.compactness != null) {
                html += this._row('圆形度', this._fmt(measurement.compactness, 4));
            }
            if (measurement.solidity != null) {
                html += this._row('实心度', this._fmt(measurement.solidity, 4));
            }
        }

        el.innerHTML = html;
    },

    _row(label, value) {
        if (value == null) return '';
        return `<div class="measure-row"><span class="measure-label">${label}</span><span class="measure-value">${value}</span></div>`;
    },

    _fmt(v, decimals) {
        if (v == null) return null;
        return Number(v).toFixed(decimals);
    },

    _fmtInt(v) {
        if (v == null) return null;
        return Math.round(v).toLocaleString();
    },
};
