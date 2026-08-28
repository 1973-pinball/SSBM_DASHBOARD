// Types for the metric definitions shared by the Metrics guide dialog and the
// static /metrics page renderer.

export interface MetricItem {
  term: string;
  def: string;
}

export interface MetricSection {
  title: string;
  items: MetricItem[];
}

export declare const SECTIONS: MetricSection[];
