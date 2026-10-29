(() => {
  const DEFAULT_COLORS = [
    '#f20c2b',
    '#ff6778',
    '#ffffff',
    '#8b0000',
    '#4d4d4d',
    '#c41d30',
  ];

  const isFiniteNumber = (value) => Number.isFinite(Number(value));
  const asArray = (value) => Array.isArray(value) ? value : [value];
  const toFont = (size, weight = '600') => `${weight} ${size}px Arial, sans-serif`;

  function getColorAt(value, index) {
    if (Array.isArray(value)) {
      return value[index % value.length] || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
    }

    if (typeof value === 'string' && value.trim()) {
      return value;
    }

    return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  }

  class ChartLite {
    constructor(ctx, config) {
      this.ctx = ctx;
      this.canvas = ctx?.canvas || null;
      this.config = config || {};
      this.destroyed = false;
      this.handleResize = this.handleResize.bind(this);
      window.addEventListener('resize', this.handleResize, { passive: true });
      this.draw();
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      window.removeEventListener('resize', this.handleResize);
      if (this.ctx && this.canvas) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }

    handleResize() {
      if (!this.destroyed) {
        this.draw();
      }
    }

    draw() {
      if (!this.ctx || !this.canvas || this.destroyed) return;

      const rect = this.canvas.getBoundingClientRect();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const width = Math.max(Math.round(rect.width || this.canvas.clientWidth || 640), 320);
      const height = Math.max(Math.round(rect.height || this.canvas.clientHeight || 280), 220);

      this.canvas.width = width * ratio;
      this.canvas.height = height * ratio;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(ratio, ratio);
      this.ctx.clearRect(0, 0, width, height);

      const type = (this.config.type || 'bar').toLowerCase();
      if (type === 'pie' || type === 'doughnut') {
        this.drawPie(width, height, type === 'doughnut');
        return;
      }

      this.drawBars(width, height);
    }

    getData() {
      return this.config.data || { labels: [], datasets: [] };
    }

    getOptions() {
      return this.config.options || {};
    }

    drawTitle(width) {
      const title = this.getOptions().plugins?.title;
      if (!title?.display || !title.text) {
        return 0;
      }

      this.ctx.save();
      this.ctx.fillStyle = title.color || '#ffffff';
      this.ctx.font = toFont(16, '700');
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'top';
      this.ctx.fillText(title.text, width / 2, 10);
      this.ctx.restore();
      return 30;
    }

    drawLegend(width, top) {
      const legend = this.getOptions().plugins?.legend;
      if (legend?.display === false) {
        return 0;
      }

      const datasets = this.getData().datasets || [];
      if (!datasets.length) {
        return 0;
      }

      const items = datasets.map((dataset, index) => ({
        label: dataset.label || `Series ${index + 1}`,
        color: getColorAt(dataset.backgroundColor || dataset.borderColor, 0),
      }));

      const ctx = this.ctx;
      const itemGap = 18;
      const swatch = 10;
      const padding = 8;
      ctx.save();
      ctx.font = toFont(12, '600');
      const widths = items.map((item) => swatch + 6 + ctx.measureText(item.label).width);
      const totalWidth = widths.reduce((sum, value) => sum + value, 0) + itemGap * Math.max(items.length - 1, 0);
      let x = Math.max((width - totalWidth) / 2, padding);
      const y = top + 4;
      items.forEach((item, index) => {
        ctx.fillStyle = item.color;
        ctx.fillRect(x, y + 2, swatch, swatch);
        ctx.fillStyle = legend?.labels?.color || '#ffffff';
        ctx.textBaseline = 'top';
        ctx.fillText(item.label, x + swatch + 6, y);
        x += widths[index] + itemGap;
      });
      ctx.restore();
      return 24;
    }

    drawBars(width, height) {
      const data = this.getData();
      const labels = Array.isArray(data.labels) ? data.labels : [];
      const datasets = Array.isArray(data.datasets) ? data.datasets : [];
      if (!labels.length || !datasets.length) {
        return;
      }

      const titleOffset = this.drawTitle(width);
      const legendOffset = this.drawLegend(width, titleOffset + 6);
      const top = 16 + titleOffset + legendOffset;
      const right = 18;
      const bottom = 42;
      const left = 38;
      const chartWidth = Math.max(width - left - right, 80);
      const chartHeight = Math.max(height - top - bottom, 80);
      const maxFromData = Math.max(...datasets.flatMap((dataset) => asArray(dataset.data).map((entry) => Number(entry) || 0)), 0);
      const yScale = this.getOptions().scales?.y;
      const maxValue = Math.max(Number(yScale?.max) || 0, maxFromData, 1);
      const tickCount = Math.max(Math.round(maxValue / (Number(yScale?.ticks?.stepSize) || 20)), 4);
      const ctx = this.ctx;

      ctx.save();
      ctx.strokeStyle = yScale?.grid?.color || 'rgba(255,255,255,0.14)';
      ctx.fillStyle = yScale?.ticks?.color || '#ffffff';
      ctx.font = toFont(11, '500');
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      for (let tick = 0; tick <= tickCount; tick += 1) {
        const value = (maxValue / tickCount) * tick;
        const y = top + chartHeight - (chartHeight * tick / tickCount);
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + chartWidth, y);
        ctx.stroke();
        ctx.fillText(String(Math.round(value)), left - 6, y);
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.beginPath();
      ctx.moveTo(left, top);
      ctx.lineTo(left, top + chartHeight);
      ctx.lineTo(left + chartWidth, top + chartHeight);
      ctx.stroke();

      const groupWidth = chartWidth / labels.length;
      const barZoneWidth = Math.max(groupWidth - 12, 8);
      const barWidth = Math.max(barZoneWidth / Math.max(datasets.length, 1), 10);

      labels.forEach((label, labelIndex) => {
        const groupX = left + groupWidth * labelIndex;
        datasets.forEach((dataset, datasetIndex) => {
          const rawValue = Number(asArray(dataset.data)[labelIndex] || 0);
          const barHeight = chartHeight * (rawValue / maxValue);
          const x = groupX + 6 + datasetIndex * barWidth;
          const y = top + chartHeight - barHeight;
          ctx.fillStyle = getColorAt(dataset.backgroundColor || dataset.borderColor, datasetIndex);
          ctx.strokeStyle = getColorAt(dataset.borderColor || dataset.backgroundColor, datasetIndex);
          ctx.lineWidth = Number(dataset.borderWidth) || 1;
          ctx.fillRect(x, y, barWidth - 4, barHeight);
          ctx.strokeRect(x, y, barWidth - 4, barHeight);
        });

        ctx.save();
        ctx.fillStyle = this.getOptions().scales?.x?.ticks?.color || '#ffffff';
        ctx.font = toFont(11, '600');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(String(label), groupX + groupWidth / 2, top + chartHeight + 8);
        ctx.restore();
      });

      ctx.restore();
    }

    drawPie(width, height, isDoughnut) {
      const data = this.getData();
      const labels = Array.isArray(data.labels) ? data.labels : [];
      const dataset = Array.isArray(data.datasets) ? data.datasets[0] : null;
      if (!labels.length || !dataset) {
        return;
      }

      const values = asArray(dataset.data).map((entry) => Math.max(Number(entry) || 0, 0));
      const total = values.reduce((sum, entry) => sum + entry, 0);
      if (total <= 0) {
        return;
      }

      const titleOffset = this.drawTitle(width);
      const radius = Math.max(Math.min(width * 0.22, height * 0.22), 48);
      const centerX = width * 0.32;
      const centerY = Math.max(height * 0.52, 110 + titleOffset / 2);
      let startAngle = -Math.PI / 2;
      const ctx = this.ctx;

      values.forEach((value, index) => {
        const angle = (value / total) * Math.PI * 2;
        const color = getColorAt(dataset.backgroundColor || dataset.borderColor, index);
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.fillStyle = color;
        ctx.arc(centerX, centerY, radius, startAngle, startAngle + angle);
        ctx.closePath();
        ctx.fill();
        startAngle += angle;
      });

      if (isDoughnut) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.font = toFont(12, '600');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      labels.forEach((label, index) => {
        const y = titleOffset + 24 + index * 22;
        const color = getColorAt(dataset.backgroundColor || dataset.borderColor, index);
        const percent = Math.round((values[index] / total) * 100);
        ctx.fillStyle = color;
        ctx.fillRect(width * 0.58, y - 6, 10, 10);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${label} (${percent}%)`, width * 0.58 + 16, y);
      });
      ctx.restore();
    }
  }

  window.Chart = ChartLite;
})();