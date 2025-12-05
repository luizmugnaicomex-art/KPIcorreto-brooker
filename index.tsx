import React, { useState, useMemo, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import firebase, { auth, firestore, FieldValue, firebaseConfig } from './firebase';
import { Chart } from 'chart.js/auto';

declare var XLSX: any;

// --- TYPE DEFINITIONS ---

enum ImportStatus {
    OrderPlaced = 'ORDER PLACED',
    ShipmentConfirmed = 'SHIPMENT CONFIRMED',
    DocumentReview = 'DOCUMENT REVIEW',
    InProgress = 'IN TRANSIT',
    AtPort = 'AT THE PORT',
    DiRegistered = 'DI REGISTERED',
    CargoReady = 'CARGO READY',
    CustomsClearance = 'CARGO CLEARED',
    Delivered = 'CARGO DELIVERED',
    Empty = 'VAZIAS',
}

enum PaymentStatus {
    Paid = 'Paid',
    Pending = 'Pending',
    Overdue = 'Overdue',
    Cancelled = 'Cancelled'
}

enum TaskStatus {
    Completed = 'Completed',
    InProgress = 'In Progress',
    Pending = 'Pending'
}

interface ContainerDetail {
    id: string;
    seaportArrivalDate?: string;
    demurrageFreeDays?: number;
}

interface Cost {
    description: string;
    value: number;
    currency: 'USD' | 'BRL' | 'EUR' | 'CNY';
    dueDate?: string;
    status: PaymentStatus;
}

interface Shipment {
  id: string;
  blAwb: string;
  poSap?: string;
  invoice?: string;
  description?: string;
  typeOfCargo?: string;
  costCenter?: string;
  qtyCarBattery?: number;
  batchChina?: string;
  color?: string;
  exTariff?: 'Yes' | 'No' | '';
  dg?: 'Yes' | 'No' | '';
  uniqueDi?: 'Yes' | 'No' | '';
  liNr?: string;
  statusLi?: string;
  underWater?: 'Yes' | 'No' | '';
  technicianResponsibleChina?: string;
  technicianResponsibleBrazil?: string;
  shipmentType?: string;
  cbm?: number;
  fcl?: number;
  lcl?: number;
  typeContainer?: string;
  incoterm?: string;
  containerUnloaded?: number;
  freightForwarderDestination?: string;
  shipper?: string;
  broker?: string;
  shipowner?: string;
  ieSentToBroker?: string;
  freeTime?: number;
  freeTimeDeadline?: string;
  arrivalVessel?: string;
  voyage?: string;
  bondedWarehouse?: string;
  actualEtd?: string;
  actualEta?: string;
  transitTime?: number;
  storageDeadline?: string;
  cargoPresenceDate?: string;
  diRegistrationDate?: string;
  greenChannelOrDeliveryAuthorizedDate?: string;
  nfIssueDate?: string;
  cargoReady?: string;
  firstTruckDelivery?: string;
  lastTruckDelivery?: string;
  invoicePaymentDate?: string;
  invoiceCurrency?: string;
  invoiceValue?: number;
  freightCurrency?: string;
  freightValue?: number;
  vlmd?: string;
  taxRateCny?: number;
  taxRateUsd?: number;
  cifDi?: string;
  nfValuePerContainer?: number;
  typeOfInspection?: string;
  qtyContainerInspection?: number;
  additionalServices?: string;
  importPlan?: string;
  importLedger?: string;
  draftDi?: string;
  approvedDraftDi?: string;
  ce?: string;
  damageReport?: 'Yes' | 'No' | '';
  di?: string;
  parametrization?: string;
  draftNf?: string;
  approvedDraftNf?: string;
  nfNacionalization?: string;
  status?: ImportStatus;
  observation?: string;
  containers: ContainerDetail[];
  costs: Cost[];
}

interface ExchangeRates {
    date: string;
    time: string;
    usd: { compra: number; venda: number };
    eur: { compra: number; venda: number };
    cny: number;
}

type UserRole = 'Admin' | 'COMEX' | 'Broker' | 'Logistics' | 'Finance';

interface User {
    id: string;
    name: string;
    username: string;
    role: UserRole;
}

interface KpiFilters {
  cargo: string[];
  year: number | 'All';
  month: number | 'All';
}

interface KPIPageProps {
  shipments: Shipment[];
  onFilterChange: (filterType: keyof KpiFilters, value: any) => void;
  filters: KpiFilters;
}

// --- UTILITY FUNCTIONS ---

const formatDate = (dateString: string | undefined): string => {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'Invalid Date';
        date.setDate(date.getDate() + 1);
        return date.toLocaleDateString('pt-BR');
    } catch (e) {
        return 'Invalid Date';
    }
};

const excelSerialDateToJSDate = (serial: number) => {
    if (typeof serial !== 'number' || isNaN(serial)) return null;
    const utc_days = Math.floor(serial - 25569);
    const utc_value = utc_days * 86400;
    const date_info = new Date(utc_value * 1000);
    return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate());
};

const parseDateFromExcel = (value: any): string => {
    if (value === null || typeof value === 'undefined' || value === '') return '';
    if (typeof value === 'number') {
        const date = excelSerialDateToJSDate(value);
        return date ? date.toISOString().split('T')[0] : '';
    }
    if (typeof value === 'string') {
        const parts = value.split(/[/.-]/);
        if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const year = parseInt(parts[2], 10);
            if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                const fullYear = year < 100 ? (year > 50 ? 1900 + year : 2000 + year) : year;
                return new Date(fullYear, month, day).toISOString().split('T')[0];
            }
        }
    }
    const parsedDate = new Date(value);
    if (!isNaN(parsedDate.getTime())) {
        return parsedDate.toISOString().split('T')[0];
    }
    return '';
};

const calculateDaysBetween = (start: string | undefined, end: string | undefined): number | null => {
    if (!start || !end) return null;
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return null;
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Fix: normalizeTerminalName to handle accents for Intermaritima
const normalizeTerminalName = (name: string | undefined): string => {
    if (!name) return 'N/A';
    // Normalize to handle accents/diacritics (e.g. Intermarítima -> intermaritima)
    const lowerName = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    if (lowerName.includes('tecon')) return 'TECON';
    if (lowerName.includes('teca')) return 'TECA';
    if (lowerName.includes('clia') && lowerName.includes('emporio')) return 'CLIA Empório';
    if (lowerName.includes('intermaritima')) return 'Intermaritima';
    if (lowerName.includes('tpc')) return 'TPC';
    return name;
}

const TERMINAL_COLOR_MAP = {
    'Intermaritima': '#28a745',
    'TPC': '#38bdf8',
    'TECON': '#f43f5e',
    'CLIA Empório': '#f59e0b',
    'N/A': '#6b7280',
    'TECA': '#a78bfa',
};

// --- UI COMPONENTS ---

const LoadingSpinner = () => (
  <div className="loading-spinner">
    <svg className="animate-spin" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.3"/>
        <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor"/>
    </svg>
  </div>
);

const Modal = ({ children, isOpen, onClose }: { children?: React.ReactNode, isOpen: boolean, onClose: () => void }) => {
    if (!isOpen) return null;
    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content animate-scale-in" onClick={e => e.stopPropagation()}>
                {children}
            </div>
        </div>
    );
};

const ShipmentsTable = ({ title, shipments, onClose }: { title: string, shipments: Shipment[], onClose: () => void }) => {
    return (
        <Modal isOpen={true} onClose={onClose}>
             <div className="shipments-table-wrapper" style={{maxHeight: '80vh', display: 'flex', flexDirection: 'column'}}>
                <div className="modal-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
                    <h3 style={{margin: 0}}>{title}</h3>
                    <button onClick={onClose} style={{background: 'none', border: 'none', cursor: 'pointer'}}><span className="material-symbols-outlined">close</span></button>
                </div>
                <div className="table-container" style={{overflowY: 'auto', flex: 1}}>
                    <table className="data-table" style={{width: '100%', borderCollapse: 'collapse'}}>
                        <thead style={{position: 'sticky', top: 0, background: 'var(--card-bg)', zIndex: 10}}>
                            <tr>
                                <th style={{padding: '10px', textAlign: 'left', borderBottom: '1px solid var(--border-color)'}}>Reference</th>
                                <th style={{padding: '10px', textAlign: 'left', borderBottom: '1px solid var(--border-color)'}}>Cargo</th>
                                <th style={{padding: '10px', textAlign: 'left', borderBottom: '1px solid var(--border-color)'}}>Status</th>
                                <th style={{padding: '10px', textAlign: 'left', borderBottom: '1px solid var(--border-color)'}}>Date</th>
                                <th style={{padding: '10px', textAlign: 'right', borderBottom: '1px solid var(--border-color)'}}>Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {shipments.map((s, idx) => (
                                <tr key={s.id || idx} style={{borderBottom: '1px solid var(--border-color)'}}>
                                    <td style={{padding: '10px'}}>
                                        <div style={{fontWeight: 500}}>{s.blAwb}</div>
                                        <div style={{fontSize: '0.8em', opacity: 0.7}}>{s.poSap || s.invoice}</div>
                                    </td>
                                    <td style={{padding: '10px'}}>{s.typeOfCargo}</td>
                                    <td style={{padding: '10px'}}>{s.status}</td>
                                    <td style={{padding: '10px'}}>{formatDate(s.actualEta || s.diRegistrationDate)}</td>
                                    <td style={{padding: '10px', textAlign: 'right'}}>
                                        {s.invoiceValue ? s.invoiceValue.toLocaleString('en-US', { style: 'currency', currency: s.invoiceCurrency || 'USD' }) : '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
             </div>
        </Modal>
    );
};

const KPIMetricCard = ({ icon, title, value }: { icon: React.ReactNode, title: string, value: string | number }) => (
    <div className="kpi-card metric-card" style={{display: 'flex', alignItems: 'center', padding: '1.5rem'}}>
        <div className="metric-icon-wrapper" style={{marginRight: '1rem', color: 'var(--primary-color)', display: 'flex', alignItems: 'center'}}>
            {icon}
        </div>
        <div>
            <div className="metric-title" style={{fontSize: '0.9rem', opacity: 0.8}}>{title}</div>
            <div className="metric-value" style={{fontSize: '1.5rem', fontWeight: 'bold'}}>{value}</div>
        </div>
    </div>
);

const BrokerageKPIFilter = ({ shipments, activeFilters, onFilterChange }: { shipments: Shipment[], activeFilters: any, onFilterChange: (key: string, value: any) => void }) => {
    const analysts = useMemo(() => {
         const set = new Set(shipments.map(s => s.technicianResponsibleBrazil).filter(Boolean));
         const toTitleCase = (str: string) => str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
         const formatted = Array.from(set).map(s => toTitleCase(s as string));
         return ['All', ...Array.from(new Set(formatted)).sort()];
    }, [shipments]);

    const years = useMemo(() => {
        const set = new Set(shipments.map(s => s.diRegistrationDate ? new Date(s.diRegistrationDate).getFullYear() : null).filter(y => y));
        return ['All', ...Array.from(set).sort((a, b) => (b as number) - (a as number))];
    }, [shipments]);
    
    const cargos = useMemo(() => {
         const set = new Set(shipments.map(s => s.typeOfCargo).filter(Boolean));
         return ['All', ...Array.from(set).sort()];
    }, [shipments]);
    
    const months = [
        { value: 'All', label: 'All' },
        { value: '1', label: 'Jan' }, { value: '2', label: 'Feb' }, { value: '3', label: 'Mar' },
        { value: '4', label: 'Apr' }, { value: '5', label: 'May' }, { value: '6', label: 'Jun' },
        { value: '7', label: 'Jul' }, { value: '8', label: 'Aug' }, { value: '9', label: 'Sep' },
        { value: '10', label: 'Oct' }, { value: '11', label: 'Nov' }, { value: '12', label: 'Dec' }
    ];

    const selectStyle = { padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--text-color)' };
    const groupStyle = { display: 'flex', flexDirection: 'column' as 'column', gap: '0.25rem' };

    return (
        <div className="brokerage-filters" style={{display: 'flex', gap: '1rem', padding: '1rem', background: 'var(--card-bg)', borderRadius: '8px', marginBottom: '1rem', flexWrap: 'wrap'}}>
            <div style={groupStyle}>
                <label style={{fontSize: '0.8rem', fontWeight: 500}}>Year</label>
                <select style={selectStyle} value={activeFilters.year} onChange={(e) => onFilterChange('year', e.target.value)}>
                    {years.map((y: any) => <option key={y} value={y}>{y}</option>)}
                </select>
            </div>
            <div style={groupStyle}>
                <label style={{fontSize: '0.8rem', fontWeight: 500}}>Month</label>
                <select style={selectStyle} value={activeFilters.month} onChange={(e) => onFilterChange('month', e.target.value)}>
                    {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
            </div>
             <div style={groupStyle}>
                <label style={{fontSize: '0.8rem', fontWeight: 500}}>Analyst</label>
                <select style={selectStyle} value={activeFilters.analyst} onChange={(e) => onFilterChange('analyst', e.target.value)}>
                    {analysts.map((a: any) => <option key={a} value={a}>{a}</option>)}
                </select>
            </div>
            <div style={groupStyle}>
                <label style={{fontSize: '0.8rem', fontWeight: 500}}>Cargo</label>
                <select style={selectStyle} value={activeFilters.cargo} onChange={(e) => onFilterChange('cargo', e.target.value)}>
                    {cargos.map((c: any) => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>
        </div>
    );
};

const KPIFilterSidebar = ({ shipments, onFilterChange, activeFilters, dateSourceField = 'actualEta' }: { shipments: Shipment[]; onFilterChange: (filterType: keyof KpiFilters, value: any) => void; activeFilters: KpiFilters; dateSourceField?: 'actualEta' | 'diRegistrationDate' }) => {
    const cargoTypes = useMemo(() => {
        const types = new Set(shipments.map(s => s.typeOfCargo).filter(Boolean));
        return Array.from(types).sort();
    }, [shipments]);

    const years = useMemo(() => {
        const yearSet = new Set(
            shipments
                .map(s => {
                    const dateString = dateSourceField === 'diRegistrationDate' ? s.diRegistrationDate : s.actualEta;
                    if (!dateString) return null;
                    const date = new Date(dateString);
                    return isNaN(date.getTime()) ? null : date.getFullYear();
                })
                .filter(y => y && !isNaN(y))
        );
        return Array.from(yearSet).sort((a, b) => b - a);
    }, [shipments, dateSourceField]);

     const months = [
        { value: 'All', label: 'All' },
        { value: 0, label: 'Jan' }, { value: 1, label: 'Feb' }, { value: 2, label: 'Mar' },
        { value: 3, label: 'Apr' }, { value: 4, label: 'May' }, { value: 5, label: 'Jun' },
        { value: 6, label: 'Jul' }, { value: 7, label: 'Aug' }, { value: 8, label: 'Sep' },
        { value: 9, label: 'Oct' }, { value: 10, label: 'Nov' }, { value: 11, label: 'Dec' }
    ];

    const handleCargoClick = (cargoType) => {
        const currentSelection = activeFilters.cargo || [];
        const newSelection = currentSelection.includes(cargoType)
            ? currentSelection.filter(c => c !== cargoType)
            : [...currentSelection, cargoType];
        onFilterChange('cargo', newSelection);
    };

    const handleClearCargo = () => {
        onFilterChange('cargo', []);
    };

    const handleYearClick = (year) => {
        onFilterChange('year', year);
    };
    
    const handleMonthClick = (month) => {
        onFilterChange('month', month);
    };

    return (
        <aside className="kpi-dashboard-sidebar">
            <div className="kpi-filter-box">
                <h4>Year</h4>
                <div className="cargo-filter-list">
                    <button onClick={() => handleYearClick('All')} className={activeFilters.year === 'All' ? 'active' : ''}>All Years</button>
                    {years.map(year => (
                        <button key={year} onClick={() => handleYearClick(year)} className={activeFilters.year === year ? 'active' : ''}>
                            {year}
                        </button>
                    ))}
                </div>
            </div>
            <div className="kpi-filter-box">
                <h4>Month</h4>
                <div className="month-filter-grid">
                     {months.map(m => (
                        <button 
                            key={m.label} 
                            onClick={() => handleMonthClick(m.value)}
                            className={activeFilters.month === m.value ? 'active' : ''}
                            style={m.value === 'All' ? {gridColumn: '1 / -1'} : {}}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="kpi-filter-box">
                <h4>Cargo</h4>
                <div className="cargo-filter-list">
                    <button onClick={handleClearCargo} className={!activeFilters.cargo || activeFilters.cargo.length === 0 ? 'active' : ''}>Clear Filters</button>
                    {cargoTypes.map(type => (
                        <button
                            key={type}
                            onClick={() => handleCargoClick(type)}
                            className={activeFilters.cargo?.includes(type) ? 'active' : ''}
                        >
                            {type}
                        </button>
                    ))}
                </div>
            </div>
        </aside>
    );
};

// --- CHART COMPONENTS ---

interface DoughnutChartProps {
    title: string;
    data: {
        label: string;
        value: number;
        secondaryValue?: number;
        color: string;
        shipments: Shipment[];
    }[];
    onSegmentClick?: ((title: string, shipments: Shipment[]) => void) | null;
    size?: number;
    strokeWidth?: number;
}

const DoughnutChart = ({ title, data, onSegmentClick = null, size = 120, strokeWidth = 15 }: DoughnutChartProps) => {
    const total = useMemo(() => data.reduce((sum, item) => sum + item.value, 0), [data]);
    const sortedData = useMemo(() => data.filter(d => d.value > 0).sort((a, b) => b.value - a.value), [data]);

    const radius = (size / 2) - strokeWidth;
    const circumference = 2 * Math.PI * radius;

    let offset = 0;

    return (
        <div className="chart-wrapper-full">
            <h4 className="doughnut-title">{title}</h4>
            <div className="doughnut-chart-container">
                <svg className="doughnut-chart-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                    <circle
                        className="doughnut-track"
                        cx={size / 2} cy={size / 2} r={radius}
                        strokeWidth={strokeWidth}
                    />
                    {sortedData.map((item) => {
                        const percentage = total > 0 ? (item.value / total) : 0;
                        const segmentLength = circumference * percentage;
                        const currentOffset = offset;
                        offset += segmentLength;

                        return (
                            <circle
                                key={item.label}
                                className="doughnut-segment"
                                cx={size / 2}
                                cy={size / 2}
                                r={radius}
                                strokeDasharray={`${segmentLength} ${circumference}`}
                                strokeDashoffset={-currentOffset}
                                stroke={item.color}
                                strokeWidth={strokeWidth}
                            />
                        );
                    })}
                     <text x={size / 2} y={size / 2} className="doughnut-total" dy=".3em">
                        {total}
                    </text>
                </svg>

                <div className="doughnut-chart-info">
                     <ul className="doughnut-legend">
                        {sortedData.map(item => {
                            const percentage = total > 0 ? (item.value / total * 100).toFixed(0) : 0;
                            const handleClick = () => {
                                if (onSegmentClick) {
                                    onSegmentClick(item.label, item.shipments);
                                }
                            };
                            return (
                                <li key={item.label}>
                                    <button
                                        className="legend-button"
                                        onClick={handleClick}
                                        disabled={!onSegmentClick}
                                        aria-label={`Filter by ${item.label}`}
                                    >
                                        <div className="legend-group">
                                            <span className="legend-marker" style={{ backgroundColor: item.color }}></span>
                                            <span className="legend-label">{item.label}</span>
                                        </div>
                                        <span className="legend-value">
                                            {title === 'DI Channel Parameterization'
                                                ? <>
                                                    {item.value}
                                                    {item.label === 'Red' && typeof item.secondaryValue !== 'undefined' && ` (${item.secondaryValue})`}
                                                  </>
                                                : `${item.value} (${percentage}%)`
                                            }
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
        </div>
    );
};

interface HorizontalBarChartProps {
    title: string;
    data: {label: string, value: number, shipments: Shipment[]}[];
    onBarClick?: ((title: string, shipments: Shipment[]) => void) | null;
    colorMap: { [key: string]: string };
}

const HorizontalBarChart = ({ title, data, onBarClick = null, colorMap }: HorizontalBarChartProps) => {
    const totalValue = useMemo(() => data.reduce((sum, item) => sum + item.value, 0), [data]);
    const sortedData = useMemo(() => data.filter(d => d.value > 0).sort((a, b) => b.value - a.value), [data]);

    return (
        <div className="chart-wrapper-full h-bar-chart-card">
            <h4 className="h-bar-chart-title">{title}</h4>
            <div className="h-bar-chart-body">
                {sortedData.map(item => {
                    const percentage = totalValue > 0 ? (item.value / totalValue) * 100 : 0;
                    const handleClick = () => {
                        if (onBarClick) {
                            onBarClick(item.label, item.shipments);
                        }
                    };
                    return (
                        <button
                            key={item.label}
                            className="h-bar-item"
                            onClick={handleClick}
                            disabled={!onBarClick}
                        >
                            <span className="h-bar-label" title={item.label}>{item.label}</span>
                            <div className="h-bar-wrapper">
                                <div
                                    className="h-bar-segment"
                                    style={{ width: percentage + '%', backgroundColor: colorMap[item.label] || 'var(--kpi-accent-blue)' }}
                                ></div>
                                <span className="h-bar-value">{item.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

interface LineChartProps {
  title: string;
  subtitle: string;
  data: Array<{value: number, shipments: Shipment[]}>;
  labels: string[];
  goal?: number;
  color: string;
  onMaximize?: (() => void) | null;
  onPointClick?: ((title: string, shipments: Shipment[]) => void) | null;
}

const LineChart = ({ title, subtitle, data, labels, goal, color, onMaximize = null, onPointClick = null }: LineChartProps) => {
    const [tooltip, setTooltip] = useState(null);
    const [viewRange, setViewRange] = useState({ start: 0, end: data.length > 0 ? data.length - 1 : 0 });
    const svgRef = useRef(null);
    const containerRef = useRef(null);

    useEffect(() => {
        setViewRange({ start: 0, end: data.length > 0 ? data.length - 1 : 0 });
    }, [data]);

    const handleZoomIn = () => {
        setViewRange(prev => {
            const currentRange = prev.end - prev.start;
            if (currentRange < 2) return prev;
            const center = prev.start + Math.floor(currentRange / 2);
            const newRange = Math.max(2, Math.ceil(currentRange / 1.5));
            const newStart = Math.max(0, center - Math.floor(newRange / 2));
            const newEnd = Math.min(data.length - 1, newStart + newRange - 1);
            return { start: newStart, end: newEnd };
        });
    };

    const handleZoomOut = () => {
        setViewRange(prev => {
            const currentRange = prev.end - prev.start;
            if (currentRange >= data.length - 1) return prev;
            const center = prev.start + Math.floor(currentRange / 2);
            const newRange = Math.min(data.length, Math.floor(currentRange * 1.5) + 1);
            let newStart = Math.max(0, center - Math.floor(newRange / 2));
            let newEnd = Math.min(data.length - 1, newStart + newRange - 1);
            if (newEnd - newStart + 1 < newRange) {
                newStart = Math.max(0, newEnd - newRange + 1);
            }
            return { start: newStart, end: newEnd };
        });
    };

    const handleResetZoom = () => {
        setViewRange({ start: 0, end: data.length > 0 ? data.length - 1 : 0 });
    };

    const visibleData = useMemo(() => data.slice(viewRange.start, viewRange.end + 1), [data, viewRange]);
    const visibleLabels = useMemo(() => labels.slice(viewRange.start, viewRange.end + 1), [labels, viewRange]);

    const { width, height, margin } = useMemo(() => {
        const container = containerRef.current;
        const w = container ? container.clientWidth : 400;
        const h = container ? container.clientHeight : 200;
        const m = { top: 20, right: 20, bottom: 30, left: 30 };
        return { width: w - m.left - m.right, height: h - m.top - m.bottom, margin: m };
    }, [containerRef.current]);

    const { xScale, yScale, linePath, areaPath, points } = useMemo(() => {
        if (visibleData.length === 0) return { xScale: () => 0, yScale: () => 0, linePath: '', areaPath: '', points: [] };

        const yMax = Math.max(...visibleData.map(d => d.value), goal || 0) * 1.1 || 10;
        const yMin = 0;

        const xScaleFn = (index) => (index / (visibleData.length > 1 ? visibleData.length - 1 : 1)) * width;
        const yScaleFn = (value) => height - ((value - yMin) / (yMax - yMin)) * height;

        const generateLine = (d, i) => `${i === 0 ? 'M' : 'L'} ${xScaleFn(i)} ${yScaleFn(d.value)}`;
        const line = visibleData.map(generateLine).join(' ');

        const area = `${line} V ${height} H ${xScaleFn(0)} Z`;

        const pts = visibleData.map((d, i) => ({
            x: xScaleFn(i),
            y: yScaleFn(d.value),
            value: d.value,
            label: visibleLabels[i],
            shipments: d.shipments,
        }));

        return { xScale: xScaleFn, yScale: yScaleFn, linePath: line, areaPath: area, points: pts };
    }, [visibleData, visibleLabels, width, height, goal]);

    const handleMouseMove = (e, point) => {
        const svgRect = svgRef.current.getBoundingClientRect();
        setTooltip({
            ...point,
            x: e.clientX - svgRect.left,
            y: e.clientY - svgRect.top,
        });
    };
    
    const handleWrapperClick = (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.closest('.line-chart-point-group')) return;
        if (onMaximize) onMaximize();
    }

    return (
        <div 
            className={`chart-wrapper-full line-chart-card ${onMaximize ? 'clickable' : ''}`}
            onClick={handleWrapperClick}
            role={onMaximize ? 'button' : undefined}
            tabIndex={onMaximize ? 0 : undefined}
            onKeyDown={(e) => {
                if (onMaximize && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onMaximize();
                }
            }}
        >
            <div className="line-chart-header">
                <div>
                    <h4>{title}</h4>
                    <p>{subtitle}</p>
                </div>
                <div className="chart-actions">
                    <button onClick={handleZoomIn} title="Zoom In" aria-label="Zoom In">+</button>
                    <button onClick={handleZoomOut} title="Zoom Out" aria-label="Zoom Out">-</button>
                    <button onClick={handleResetZoom} title="Reset Zoom" aria-label="Reset Zoom">⟳</button>
                </div>
            </div>
            <div className="line-chart-container" ref={containerRef}>
                {width > 0 && height > 0 && (
                     <svg ref={svgRef} className="line-chart-svg" viewBox={`0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`}>
                        <g transform={`translate(${margin.left},${margin.top})`}>
                            <g className="line-chart-grid">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <line key={i} x1="0" x2={width} y1={i * height / 4} y2={i * height / 4} />
                                ))}
                            </g>
                            <g className="line-chart-axis">
                                {Array.from({ length: 5 }).map((_, i) => {
                                    const yValue = (Math.max(...visibleData.map(d => d.value), goal || 0) * 1.1 || 10) * (1 - i / 4);
                                    return (
                                        <text key={i} x="-10" y={i * height / 4} dy="0.32em" textAnchor="end">{Math.round(yValue)}</text>
                                    );
                                })}
                                {points.map((p, i) => i % Math.ceil(visibleLabels.length / 10) === 0 && (
                                    <text key={i} x={p.x} y={height + 15} textAnchor="middle">{p.label}</text>
                                ))}
                            </g>
                            {goal && <line className="line-chart-goal" x1="0" x2={width} y1={yScale(goal)} y2={yScale(goal)} />}
                            <path className="line-chart-area" d={areaPath} style={{ fill: color, opacity: 0.1 }} />
                            <path className="line-chart-line" d={linePath} style={{ stroke: color }} />
                            {points.map((p, i) => (
                                <g key={i} className="line-chart-point-group"
                                   onClick={() => onPointClick && onPointClick(`${title} in ${p.label}`, p.shipments)}
                                   onMouseMove={(e) => handleMouseMove(e, p)}
                                   onMouseLeave={() => setTooltip(null)}>
                                    <circle className="line-chart-point" cx={p.x} cy={p.y} style={{ stroke: color }} />
                                    <text className="line-chart-data-label" x={p.x} y={p.y - 10} textAnchor="middle">{p.value}</text>
                                </g>
                            ))}
                        </g>
                    </svg>
                )}
                 {tooltip && (
                    <div className="line-chart-tooltip" style={{ left: tooltip.x, top: tooltip.y, opacity: 1, pointerEvents: 'none' }}>
                        <span className="tooltip-label">{tooltip.label}: </span>
                        <span className="tooltip-value">{tooltip.value}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

interface VerticalBarChartData {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    terminals?: string[];
    shipments?: Shipment[][];
  }>;
}

const VerticalBarChart = ({ title, data, onSegmentClick = null }: { title: string; data: VerticalBarChartData, onSegmentClick?: ((title: string, shipments: Shipment[]) => void) | null }) => {
    if (!data || !data.datasets || data.datasets.length === 0) return <div className="no-data-message">No data for {title}</div>;

    const { labels, datasets } = data;
    const totals = labels.map((_, i) => datasets.reduce((sum: number, ds) => sum + (ds.data[i] || 0), 0));
    const maxTotal = Math.max(...totals) * 1.1 || 10;

    const cargoVolumeLegend = useMemo(() => Object.entries(TERMINAL_COLOR_MAP).map(([label, color]) => ({ label, color })), []);

    return (
        <div className="chart-wrapper-full v-bar-chart-card">
            <h4 className="v-bar-chart-title">{title}</h4>
            <div className="v-bar-chart-container" style={{ gridTemplateColumns: `repeat(${labels.length}, 1fr)` }}>
                {labels.map((label: string, i) => (
                    <div key={label} className="v-bar-group">
                        <div className="v-bar-total">{totals[i]}</div>
                        <div className="v-bar-stack" style={{ height: '150px' }}>
                            {datasets.map(ds => {
                                const value = ds.data[i] || 0;
                                if (value === 0) return null;
                                const height = maxTotal > 0 ? (value / maxTotal) * 100 : 0;
                                const terminal = ds.terminals ? ds.terminals[i] : ds.label;
                                const shipments = ds.shipments ? ds.shipments[i] : [];
                                
                                const handleClick = () => {
                                    if (onSegmentClick && shipments) {
                                        onSegmentClick(`${ds.label} in ${label}`, shipments);
                                    }
                                };

                                const terminalColor = TERMINAL_COLOR_MAP[terminal];
                                if (!terminalColor) {
                                    console.warn(`VerticalBarChart: Missing color for terminal "${terminal}"`);
                                }

                                return (
                                    <button
                                        key={ds.label + '-' + i}
                                        className="v-bar-segment"
                                        onClick={handleClick}
                                        disabled={!onSegmentClick}
                                        style={{ height: height + '%', backgroundColor: terminalColor || '#6b7280' }}
                                        title={terminal + ': ' + value}
                                    ></button>
                                );
                            })}
                        </div>
                        <span className="v-bar-label">{label}</span>
                    </div>
                ))}
            </div>
             {title === 'Cargo Volume' && (
                <div className="v-bar-legend">
                    {cargoVolumeLegend.map(item => (
                        <div key={item.label} className="v-bar-legend-item">
                            <span className="legend-marker" style={{ backgroundColor: item.color }}></span>
                            <span>{item.label}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// --- PAGES ---

const LoginPage = ({ onLoginSuccess }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            await auth.signInWithEmailAndPassword(email, password);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-box">
                <div className="login-header">
                    <img src="https://i.imgur.com/O9a1Y5B.png" alt="BYD Logo" />
                    <h1>Navigator</h1>
                    <p>International Trade Division 11</p>
                </div>
                <form onSubmit={handleLogin}>
                    {error && <p className="error-message">{error}</p>}
                    <div className="input-group">
                        <label htmlFor="email">Email</label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div className="input-group">
                        <label htmlFor="password">Password</label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>
                    <button type="submit" className="login-button" disabled={isLoading}>
                        {isLoading ? <LoadingSpinner /> : 'Login'}
                    </button>
                </form>
            </div>
        </div>
    );
};

const DashboardPage = ({ shipments, onNavigate }) => {
    const kpiData = useMemo(() => {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);

        const recentShipments = shipments.filter(s => s.actualEta && new Date(s.actualEta) > thirtyDaysAgo);
        const totalValueRecent = recentShipments.reduce((sum: number, s) => sum + (s.invoiceValue || 0), 0);
        const onTimeShipments = shipments.filter(s => s.status === 'CARGO DELIVERED' && s.actualEta && s.lastTruckDelivery && new Date(s.lastTruckDelivery) <= new Date(s.actualEta)).length;
        const totalDelivered = shipments.filter(s => s.status === 'CARGO DELIVERED').length;
        const onTimePercentage = totalDelivered > 0 ? (onTimeShipments / totalDelivered * 100).toFixed(0) : '0';
        const inTransitCount = shipments.filter(s => s.status === 'IN TRANSIT').length;

        return {
            totalValue: totalValueRecent,
            onTime: onTimePercentage,
            inTransit: inTransitCount,
            totalShipments: shipments.length
        };
    }, [shipments]);

    const actionItems = useMemo(() => {
        const todayStr = new Date().toISOString().split('T')[0];
        const arrivingToday = shipments.filter(s => {
            if (!s.actualEta) return false;
            return s.actualEta.split('T')[0] === todayStr;
        }).length;

        const docsPending = shipments.filter(s => 
            s.status === ImportStatus.DocumentReview || 
            (s.status === ImportStatus.DiRegistered && (!s.approvedDraftDi || s.approvedDraftDi !== 'OK'))
        ).length;

        return { arrivingToday, docsPending };
    }, [shipments]);

    const shipmentStatusData = useMemo(() => {
        const statusConfig = [
            { label: 'Order Placed', statuses: [ImportStatus.OrderPlaced], color: '#6c757d' },
            { label: 'In Transit', statuses: [ImportStatus.InProgress], color: '#3b82f6' },
            { label: 'At Port', statuses: [ImportStatus.AtPort, ImportStatus.CargoReady], color: '#ef4444' },
            { label: 'Delivered', statuses: [ImportStatus.Delivered], color: '#10b981' }
        ];

        return statusConfig.map(config => {
            const matching = shipments.filter(s => s.status && config.statuses.includes(s.status as ImportStatus));
            return {
                label: config.label,
                value: matching.length,
                shipments: matching,
                color: config.color
            };
        });
    }, [shipments]);


    const handleSegmentClick = (label, filteredShipments) => {
        let statusFilter = 'All';
        if (label === 'Order Placed') statusFilter = ImportStatus.OrderPlaced;
        if (label === 'In Transit') statusFilter = ImportStatus.InProgress;
        if (label === 'At Port') statusFilter = ImportStatus.AtPort;
        if (label === 'Delivered') statusFilter = ImportStatus.Delivered;
        onNavigate('Imports', { statusFilter });
    };

    return (
        <div className="dashboard-page">
             <div className="dashboard-welcome-section">
                <h1 className="dashboard-welcome-text">Welcome back, User!</h1>
                
                <div className="search-bar-container">
                    <span className="material-symbols-outlined">search</span>
                    <input type="text" className="search-input" placeholder="Find shipments or documents" />
                </div>

                <div className="quick-actions-grid">
                    <button className="quick-action-card">
                        <span className="material-symbols-outlined">add_box</span>
                        <span className="quick-action-label">Create Entry</span>
                    </button>
                    <button className="quick-action-card">
                        <span className="material-symbols-outlined">local_shipping</span>
                        <span className="quick-action-label">Track Shipment</span>
                    </button>
                    <button className="quick-action-card">
                        <span className="material-symbols-outlined">description</span>
                        <span className="quick-action-label">View Docs</span>
                    </button>
                </div>
            </div>

            <h2 className="overview-header">Overview</h2>
            
            <div className="kpi-grid">
                 <div className="kpi-card">
                    <div className="kpi-header-row">
                        <span className="kpi-title">Active Imports</span>
                        <span className="material-symbols-outlined" style={{color: 'var(--success-color)'}}>trending_up</span>
                    </div>
                    <div className="kpi-value">{kpiData.inTransit}</div>
                    <a href="#" className="kpi-link" onClick={() => onNavigate('Imports', {statusFilter: ImportStatus.InProgress})}>View all</a>
                </div>
                <div className="kpi-card">
                    <div className="kpi-header-row">
                        <span className="kpi-title">Customs Pending</span>
                        <span className="material-symbols-outlined" style={{color: 'var(--warning-color)'}}>hourglass_top</span>
                    </div>
                    <div className="kpi-value">{actionItems.docsPending}</div>
                    <a href="#" className="kpi-link">Requires attention</a>
                </div>
                <div className="kpi-card">
                    <div className="kpi-header-row">
                        <span className="kpi-title">Arriving Today</span>
                        <span className="material-symbols-outlined" style={{color: 'var(--info-color)'}}>event_available</span>
                    </div>
                    <div className="kpi-value">{actionItems.arrivingToday}</div>
                    <a href="#" className="kpi-link">Check schedule</a>
                </div>
                 <div className="kpi-card">
                    <div className="kpi-header-row">
                        <span className="kpi-title">Total Value (30d)</span>
                        <span className="material-symbols-outlined" style={{color: 'var(--primary-color)'}}>payments</span>
                    </div>
                    <div className="kpi-value" style={{fontSize: '1.8rem'}}>{kpiData.totalValue.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</div>
                </div>
            </div>
            
            <div className="dashboard-grid">
                <div className="dashboard-card chart-card">
                     <h3 className="card-title">Shipment Status</h3>
                     <DoughnutChart 
                        title="" 
                        data={shipmentStatusData} 
                        onSegmentClick={handleSegmentClick} 
                        size={220}
                        strokeWidth={25}
                    />
                </div>
            </div>
        </div>
    );
};

const CargosInTransitDashboard = ({ shipments, onFilterChange, filters }: KPIPageProps) => {
    const [selectedShipments, setSelectedShipments] = useState<{title: string, data: Shipment[]} | null>(null);

    const handleChartClick = (title: string, shipments: Shipment[]) => {
        setSelectedShipments({ title: `Shipments for: ${title}`, data: shipments });
    };
    
    const filteredShipments = useMemo(() => {
        return shipments.filter(s => {
            const cargoMatch = !filters.cargo || filters.cargo.length === 0 || filters.cargo.includes(s.typeOfCargo);
             if (!s.actualEta) return false;
            const shipmentDate = new Date(s.actualEta);
            if (isNaN(shipmentDate.getTime())) return false;
            const yearMatch = filters.year === 'All' || shipmentDate.getFullYear() === filters.year;
            const monthMatch = filters.month === 'All' || shipmentDate.getMonth() === filters.month;
            return cargoMatch && yearMatch && monthMatch;
        });
    }, [shipments, filters]);

    const shipmentsData = useMemo(() => {
        const groups: { [key: string]: Shipment[] } = { 'CIF': [], 'FOB': [], 'DAP': [] };
        filteredShipments.forEach(s => {
            if (s.incoterm && groups.hasOwnProperty(s.incoterm)) {
                groups[s.incoterm].push(s);
            }
        });
        return Object.entries(groups).map(([label, shipments]) => ({ label, value: shipments.length, shipments, color: { 'CIF': '#8b5cf6', 'FOB': '#3b82f6', 'DAP': '#ec4899' }[label] }));
    }, [filteredShipments]);
    
    const shipmentStatusData = useMemo(() => {
        const groups: { [key: string]: Shipment[] } = { 'Doc Review': [], 'In Transit': [], 'At Port': [] };
        filteredShipments.forEach(s => {
            if (s.status === 'DOCUMENT REVIEW') groups['Doc Review'].push(s);
            if (s.status === 'IN TRANSIT') groups['In Transit'].push(s);
            if (s.status === 'AT THE PORT' || s.status === 'CARGO READY') groups['At Port'].push(s);
        });
        return Object.entries(groups).map(([label, shipments]) => ({ label, value: shipments.length, shipments, color: { 'Doc Review': '#f97316', 'In Transit': '#3b82f6', 'At Port': '#ef4444' }[label] }));
    }, [filteredShipments]);
    
    const sapPoStatusData = useMemo(() => {
        const groups: { [key: string]: Shipment[] } = { 'OK': [], 'Pending': [] };
        filteredShipments.forEach(s => s.poSap ? groups['OK'].push(s) : groups['Pending'].push(s));
        return Object.entries(groups).map(([label, shipments]) => ({ label, value: shipments.length, shipments, color: { 'OK': '#10b981', 'Pending': '#ef4444' }[label] }));
    }, [filteredShipments]);

    const docStatusData = useMemo(() => {
        const groups: { [key: string]: Shipment[] } = { 'Approved': [], 'Not Approved': [] };
        filteredShipments.forEach(s => groups['Approved'].push(s));
        return Object.entries(groups).map(([label, shipments]) => ({ label, value: shipments.length, shipments, color: { 'Approved': '#10b981', 'Not Approved': '#ef4444' }[label] }));
    }, [filteredShipments]);
    
    const cargoVolumeDataStack = useMemo(() => {
        const months: { [key: string]: { [key: string]: { volume: number, shipments: Shipment[]} } } = {};
        const terminals = new Set<string>();
        const monthLabels = ['Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

        monthLabels.forEach(m => (months[m] = {}));

        filteredShipments.forEach(s => {
            if (s.actualEta) {
                const date = new Date(s.actualEta);
                if (isNaN(date.getTime())) return;

                const monthIndex: number = date.getMonth(); 
                if (monthIndex >= 6) {
                    const monthName = monthLabels[monthIndex - 6];
                    const terminal = normalizeTerminalName(s.bondedWarehouse);
                    terminals.add(terminal);

                    let containerVolume = 0;
                    if (s.shipmentType === 'FCL' || s.shipmentType === 'FCL/LCL') {
                        containerVolume = s.fcl || 0;
                    }
                    if (containerVolume > 0) {
                        if (!months[monthName][terminal]) months[monthName][terminal] = { volume: 0, shipments: [] };
                        months[monthName][terminal].volume += containerVolume;
                        months[monthName][terminal].shipments.push(s);
                    }
                }
            }
        });

        const sortedTerminals = Array.from(terminals).sort();

        return {
            labels: monthLabels,
            datasets: sortedTerminals.map(terminal => ({
                label: terminal,
                data: monthLabels.map(m => months[m][terminal]?.volume || 0),
                terminals: monthLabels.map(() => terminal),
                shipments: monthLabels.map(m => months[m][terminal]?.shipments || []),
            })),
        };
    }, [filteredShipments]);


    return (
        <div className="cargos-in-transit-grid">
            <KPIFilterSidebar shipments={shipments} onFilterChange={onFilterChange} activeFilters={filters} />
            <main className="kpi-dashboard-main-grid">
                <div className="kpi-main-charts">
                    <DoughnutChart title="Shipments" data={shipmentsData} onSegmentClick={handleChartClick} />
                    <DoughnutChart title="Shipment Status" data={shipmentStatusData} onSegmentClick={handleChartClick} />
                    <DoughnutChart title="SAP PO Status" data={sapPoStatusData} onSegmentClick={handleChartClick} />
                    <DoughnutChart title="Document Status" data={docStatusData} onSegmentClick={handleChartClick} />
                </div>
                <VerticalBarChart title="Cargo Volume" data={cargoVolumeDataStack} onSegmentClick={handleChartClick} />
                {selectedShipments && (
                    <ShipmentsTable 
                        title={selectedShipments.title} 
                        shipments={selectedShipments.data} 
                        onClose={() => setSelectedShipments(null)} 
                    />
                )}
            </main>
        </div>
    );
}

const PerformanceDashboard = ({ shipments, onFilterChange, filters }: KPIPageProps) => {
    const [maximizedChart, setMaximizedChart] = useState(null);
    const [selectedShipments, setSelectedShipments] = useState<{title: string, data: Shipment[]} | null>(null);

    const handleChartClick = (title: string, shipments: Shipment[]) => {
        setSelectedShipments({ title: `Shipments for: ${title}`, data: shipments });
    };

    const filteredShipments = useMemo(() => {
        return shipments.filter(s => {
            const cargoMatch = !filters.cargo || filters.cargo.length === 0 || filters.cargo.includes(s.typeOfCargo);
            if (!s.diRegistrationDate) return false;
            const shipmentDate = new Date(s.diRegistrationDate);
            if (isNaN(shipmentDate.getTime())) return false;
            const yearMatch = filters.year === 'All' || shipmentDate.getFullYear() === filters.year;
            const monthMatch = filters.month === 'All' || shipmentDate.getMonth() === filters.month;
            return cargoMatch && yearMatch && monthMatch;
        });
    }, [shipments, filters]);
    
    const incotermData = useMemo(() => {
        const groups: { [key: string]: Shipment[] } = { 'DAP': [], 'CIF': [], 'FOB': [] };
        filteredShipments.forEach(s => {
            if (s.incoterm && groups.hasOwnProperty(s.incoterm)) {
                groups[s.incoterm].push(s);
            }
        });
        return Object.entries(groups).map(([label, shipments]) => ({ label, value: shipments.length, shipments, color: { 'DAP': '#a855f7', 'CIF': '#3b82f6', 'FOB': '#10b981' }[label] }));
    }, [filteredShipments]);

    const diParamData = useMemo(() => {
        const groups: { [key: string]: { uniqueDIs: Map<string, Shipment> } } = {
            'Green': { uniqueDIs: new Map() },
            'Yellow': { uniqueDIs: new Map() },
            'Red': { uniqueDIs: new Map() },
        };

        filteredShipments.forEach(s => {
            if (s.di && s.parametrization && groups.hasOwnProperty(s.parametrization)) {
                if (!groups[s.parametrization].uniqueDIs.has(s.di)) {
                    groups[s.parametrization].uniqueDIs.set(s.di, s);
                }
            }
        });

        return Object.entries(groups).map(([label, data]) => ({
            label,
            value: data.uniqueDIs.size,
            shipments: Array.from(data.uniqueDIs.values()),
            color: { 'Green': '#10b981', 'Yellow': '#facc15', 'Red': '#ef4444' }[label]
        }));
    }, [filteredShipments]);
    
    const disPerMonth = useMemo(() => {
        const monthlyUniqueDIs = Array(12).fill(null).map(() => new Map<string, Shipment>());

        filteredShipments.forEach(shipment => {
            if (shipment.di && shipment.diRegistrationDate) {
                try {
                    const date = new Date(shipment.diRegistrationDate);
                    if (!isNaN(date.getTime())) {
                        const month = date.getMonth();
                        if (month >= 0 && month < 12) {
                            if (!monthlyUniqueDIs[month].has(shipment.di)) {
                                monthlyUniqueDIs[month].set(shipment.di, shipment);
                            }
                        }
                    }
                } catch (e) {
                    console.error("Invalid date for DI Registration:", shipment.diRegistrationDate);
                }
            }
        });

        const monthlyCounts = monthlyUniqueDIs.map(s => s.size);
        const monthlyShipments = monthlyUniqueDIs.map(s => Array.from(s.values()));
        
        const labels = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        
        return {
            labels: labels,
            datasets: [{
                label: 'DIs',
                data: monthlyCounts,
                shipments: monthlyShipments,
            }]
        };
    }, [filteredShipments]);

    const lineChartData = useMemo(() => {
        const months = Array(12).fill(null).map(() => ({ 
            clearance: [], delivery: [], operation: [], nf: [],
            clearanceShipments: [], deliveryShipments: [], operationShipments: [], nfShipments: []
        }));
        
        const shipmentsForPerf = filteredShipments.filter(s => s.uniqueDi !== 'Yes');

        shipmentsForPerf.forEach(s => {
            if (s.diRegistrationDate) {
                const date = new Date(s.diRegistrationDate);
                if (isNaN(date.getTime())) return;
                const month = date.getMonth();
                if (month >= 0 && month < 12) {
                    const clearance = calculateDaysBetween(s.cargoPresenceDate, s.greenChannelOrDeliveryAuthorizedDate);
                    const delivery = calculateDaysBetween(s.greenChannelOrDeliveryAuthorizedDate, s.firstTruckDelivery);
                    const operation = calculateDaysBetween(s.actualEta, s.greenChannelOrDeliveryAuthorizedDate);
                    const nf = calculateDaysBetween(s.greenChannelOrDeliveryAuthorizedDate, s.nfIssueDate);

                    if (clearance !== null) { months[month].clearance.push(clearance); months[month].clearanceShipments.push(s); }
                    if (delivery !== null) { months[month].delivery.push(delivery); months[month].deliveryShipments.push(s); }
                    if (operation !== null) { months[month].operation.push(operation); months[month].operationShipments.push(s); }
                    if (nf !== null) { months[month].nf.push(nf); months[month].nfShipments.push(s); }
                }
            }
        });
        
        const avg = (arr: number[]) => arr.length ? arr.reduce((a: number, b: number) => a + b, 0) / arr.length : 0;
        
        const labels = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        
        return {
            labels,
            clearance: months.map(m => ({ value: Math.round(avg(m.clearance)), shipments: m.clearanceShipments })),
            delivery: months.map(m => ({ value: Math.round(avg(m.delivery)), shipments: m.deliveryShipments })),
            operation: months.map(m => ({ value: Math.round(avg(m.operation)), shipments: m.operationShipments })),
            nf: months.map(m => ({ value: Math.round(avg(m.nf)), shipments: m.nfShipments })),
        };

    }, [filteredShipments]);

    const chartProps = {
        clearance: { title: "Clearance Time", subtitle: "Business Days - Goal: 5", data: lineChartData.clearance, labels: lineChartData.labels, goal: 5, color: "var(--kpi-accent-cyan)" },
        delivery: { title: "Delivery Time", subtitle: "Business Days - Goal: 3", data: lineChartData.delivery, labels: lineChartData.labels, goal: 3, color: "var(--kpi-accent-green)" },
        operation: { title: "Operation Time", subtitle: "Business Days - Goal: 8", data: lineChartData.operation, labels: lineChartData.labels, goal: 8, color: "var(--kpi-accent-blue)" },
        nf: { title: "NF Issue Time", subtitle: "Business Days - Goal: 6", data: lineChartData.nf, labels: lineChartData.labels, goal: 6, color: "var(--kpi-accent-purple)" },
    };

    return (
        <div className="performance-grid">
            <KPIFilterSidebar shipments={shipments} onFilterChange={onFilterChange} activeFilters={filters} dateSourceField="diRegistrationDate" />
            <main className="performance-main">
                <div className="performance-top-row">
                    <DoughnutChart title="Incoterm" data={incotermData} onSegmentClick={handleChartClick} />
                    <VerticalBarChart title="DIs Registers" data={disPerMonth} onSegmentClick={handleChartClick} />
                    <DoughnutChart title="DI Parameterization" data={diParamData} strokeWidth={20} onSegmentClick={handleChartClick} />
                </div>
                <div className="performance-bottom-row">
                    <LineChart {...chartProps.clearance} onMaximize={() => setMaximizedChart(chartProps.clearance)} onPointClick={handleChartClick} />
                    <LineChart {...chartProps.delivery} onMaximize={() => setMaximizedChart(chartProps.delivery)} onPointClick={handleChartClick} />
                    <LineChart {...chartProps.operation} onMaximize={() => setMaximizedChart(chartProps.operation)} onPointClick={handleChartClick} />
                    <LineChart {...chartProps.nf} onMaximize={() => setMaximizedChart(chartProps.nf)} onPointClick={handleChartClick} />
                </div>
                 {selectedShipments && (
                    <ShipmentsTable 
                        title={selectedShipments.title} 
                        shipments={selectedShipments.data} 
                        onClose={() => setSelectedShipments(null)} 
                    />
                )}
            </main>
            {maximizedChart && (
                <div className="chart-modal-backdrop" onClick={() => setMaximizedChart(null)}>
                    <div className="chart-modal-content" onClick={e => e.stopPropagation()}>
                        <LineChart {...maximizedChart} />
                    </div>
                </div>
            )}
        </div>
    );
}

const OperationStatusDashboard = ({ shipments, onFilterChange, filters }: KPIPageProps) => {
    const [selectedShipments, setSelectedShipments] = useState<{title: string, data: Shipment[]} | null>(null);

    const handleChartClick = (title: string, shipments: Shipment[]) => {
        setSelectedShipments({ title: `Shipments for: ${title}`, data: shipments });
    };

    const filteredShipments = useMemo(() => {
        return shipments.filter(s => {
            const cargoMatch = !filters.cargo || filters.cargo.length === 0 || filters.cargo.includes(s.typeOfCargo);
            if (!s.actualEta) return false;
            const shipmentDate = new Date(s.actualEta);
            if (isNaN(shipmentDate.getTime())) return false;
            const yearMatch = filters.year === 'All' || shipmentDate.getFullYear() === filters.year;
            const monthMatch = filters.month === 'All' || shipmentDate.getMonth() === filters.month;
            return cargoMatch && yearMatch && monthMatch;
        });
    }, [shipments, filters]);

    const statusByBLsData = useMemo(() => {
        const groups: { [key: string]: Shipment[] } = {
            'IN TRANSIT': [], 'AT THE PORT': [], 'DI REGISTERED': [], 'CARGO CLEARED': []
        };
        filteredShipments.forEach(s => {
            if (!s.status) return;
            if (groups.hasOwnProperty(s.status)) {
                groups[s.status].push(s);
            } else if (s.status === 'CARGO READY') {
                groups['AT THE PORT'].push(s);
            }
        });
        return Object.entries(groups).map(([label, shipments]) => ({
            label, value: shipments.length, shipments,
            color: { 'IN TRANSIT': '#3b82f6', 'AT THE PORT': '#f97316', 'DI REGISTERED': '#facc15', 'CARGO CLEARED': '#10b981' }[label]
        }));
    }, [filteredShipments]);

    const statusByContainersData = useMemo(() => {
        const groups: { [key: string]: { shipments: Shipment[], count: number } } = {
            'IN TRANSIT': {shipments: [], count: 0}, 'AT THE PORT': {shipments: [], count: 0}, 
            'DI REGISTERED': {shipments: [], count: 0}, 'CARGO CLEARED': {shipments: [], count: 0}
        };
        filteredShipments.forEach(s => {
            const containerCount = (s.shipmentType === 'FCL' || s.shipmentType === 'FCL/LCL') ? (s.fcl || 1) : 0;
            if (s.status && groups.hasOwnProperty(s.status)) {
                groups[s.status].count += containerCount;
                groups[s.status].shipments.push(s);
            } else if (s.status === 'CARGO READY') {
                groups['AT THE PORT'].count += containerCount;
                groups['AT THE PORT'].shipments.push(s);
            }
        });
        return Object.entries(groups).map(([label, data]) => ({
            label, value: Math.round(data.count), shipments: data.shipments,
            color: { 'IN TRANSIT': '#3b82f6', 'AT THE PORT': '#f97316', 'DI REGISTERED': '#facc15', 'CARGO CLEARED': '#10b981' }[label]
        }));
    }, [filteredShipments]);
    
    const cargoValueByWarehouseData = useMemo(() => {
        const warehouses: { [key: string]: { shipments: Shipment[], total: number } } = {};
        filteredShipments.forEach(s => {
            const warehouse = normalizeTerminalName(s.bondedWarehouse);
            if (warehouse !== 'N/A') {
                if (!warehouses[warehouse]) warehouses[warehouse] = { shipments: [], total: 0 };
                warehouses[warehouse].total += (s.invoiceValue || 0);
                warehouses[warehouse].shipments.push(s);
            }
        });
        return Object.entries(warehouses).map(([label, data]) => ({ label, value: data.total, shipments: data.shipments }));
    }, [filteredShipments]);
    
    const containerVolumeByWarehouseData = useMemo(() => {
         const warehouses: { [key: string]: { shipments: Shipment[], total: number } } = {};
        filteredShipments.forEach(s => {
            const warehouse = normalizeTerminalName(s.bondedWarehouse);
            if (warehouse !== 'N/A') {
                if (!warehouses[warehouse]) warehouses[warehouse] = { shipments: [], total: 0 };
                const containerCount = (s.shipmentType === 'FCL' || s.shipmentType === 'FCL/LCL') ? (s.fcl || 1) : 0;
                warehouses[warehouse].total += containerCount;
                warehouses[warehouse].shipments.push(s);
            }
        });
        return Object.entries(warehouses).map(([label, data]) => ({ label, value: data.total, shipments: data.shipments }));
    }, [filteredShipments]);
    

    return (
        <div className="operation-status-grid">
            <KPIFilterSidebar shipments={shipments} onFilterChange={onFilterChange} activeFilters={filters} />
            <main className="operation-status-main">
                <div className="operation-charts-column">
                    <DoughnutChart title="Shipment Status (by BLs)" data={statusByBLsData} onSegmentClick={handleChartClick} />
                    <DoughnutChart title="Shipment Status (by Containers)" data={statusByContainersData} onSegmentClick={handleChartClick} />
                </div>
                <div className="operation-charts-column">
                     <HorizontalBarChart title="Cargo Value" data={cargoValueByWarehouseData} colorMap={TERMINAL_COLOR_MAP} onBarClick={handleChartClick} />
                     <HorizontalBarChart title="Container Volume" data={containerVolumeByWarehouseData} colorMap={TERMINAL_COLOR_MAP} onBarClick={handleChartClick} />
                </div>
                {selectedShipments && (
                    <div className="operation-charts-column" style={{gridColumn: '1 / -1'}}>
                        <ShipmentsTable 
                            title={selectedShipments.title} 
                            shipments={selectedShipments.data} 
                            onClose={() => setSelectedShipments(null)} 
                        />
                    </div>
                )}
            </main>
        </div>
    );
};

const KPIsPage = ({ shipments }: { shipments: Shipment[] }) => {
    const [activeTab, setActiveTab] = useState('Cargos in Transit');
    
    const latestYear = useMemo(() => {
        const years = shipments
            .map(s => {
                if (!s.actualEta) return null;
                const date = new Date(s.actualEta);
                return isNaN(date.getTime()) ? null : date.getFullYear();
            })
            .filter(y => y && !isNaN(y)) as number[];
        return years.length > 0 ? Math.max(...years) : new Date().getFullYear();
    }, [shipments]);

    const [filters, setFilters] = useState<KpiFilters>({ cargo: [], year: latestYear, month: 'All' });
    
    useEffect(() => {
        setFilters(f => ({ ...f, year: latestYear }));
    }, [latestYear]);

    const handleFilterChange = (filterType, value) => {
        setFilters(prev => ({ ...prev, [filterType]: value }));
    };

    const renderActiveDashboard = () => {
        switch (activeTab) {
            case 'Cargos in Transit':
                return <CargosInTransitDashboard shipments={shipments} onFilterChange={handleFilterChange} filters={filters} />;
            case 'Performance':
                return <PerformanceDashboard shipments={shipments} onFilterChange={handleFilterChange} filters={filters} />;
            case 'Operation Status':
                return <OperationStatusDashboard shipments={shipments} onFilterChange={handleFilterChange} filters={filters} />;
            default:
                return null;
        }
    };

    return (
        <div className="kpis-page">
            <header className="kpi-dashboard-header">
                <div className="kpi-dashboard-title">
                     <h1>INTERNATIONAL TRADE - DIVISION 11</h1>
                     <h2>{activeTab.toUpperCase()}</h2>
                </div>
                <div className="kpi-dashboard-flags">
                    <img src="https://flagcdn.com/cn.svg" alt="China Flag" style={{ height: '40px' }} />
                    <img src="https://flagcdn.com/br.svg" alt="Brazil Flag" style={{ height: '40px' }} />
                </div>
            </header>
            <nav className="kpi-tabs">
                <button className={activeTab === 'Cargos in Transit' ? 'active' : ''} onClick={() => setActiveTab('Cargos in Transit')}>Cargos in Transit</button>
                <button className={activeTab === 'Performance' ? 'active' : ''} onClick={() => setActiveTab('Performance')}>Performance</button>
                <button className={activeTab === 'Operation Status' ? 'active' : ''} onClick={() => setActiveTab('Operation Status')}>Operation Status</button>
            </nav>
            <div className="kpi-content">
                {renderActiveDashboard()}
            </div>
        </div>
    );
};

const BrokerageKPIsPage = ({ shipments }: { shipments: Shipment[] }) => {
  const [filters, setFilters] = useState({
    analyst: 'All',
    month: 'All',
    year: new Date().getFullYear().toString(),
    cargo: 'All'
  });
  const [selectedShipments, setSelectedShipments] = useState<{title: string, data: Shipment[]} | null>(null);

  const handleChartClick = (title: string, shipments: Shipment[]) => {
      setSelectedShipments({ title: `Shipments for: ${title}`, data: shipments });
  };

  const handleFilterChange = (filterName, value) => {
    setFilters(prev => ({ ...prev, [filterName]: value }));
  };

  const filteredShipments = useMemo(() => {
    const toTitleCase = (str: string | undefined): string => {
        if (!str) return '';
        return str.replace(
            /\w\S*/g,
            (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
        );
    };

    return shipments.filter(s => {
      const shipDate = s.diRegistrationDate ? new Date(s.diRegistrationDate) : null;
      if (!shipDate || isNaN(shipDate.getTime())) return false;
      const yearMatch = filters.year === 'All' || shipDate.getFullYear().toString() === filters.year;
      const monthMatch = filters.month === 'All' || (shipDate.getMonth() + 1).toString() === filters.month;
      const analystMatch = filters.analyst === 'All' || toTitleCase(s.technicianResponsibleBrazil) === filters.analyst;
      const cargoMatch = filters.cargo === 'All' || s.typeOfCargo === filters.cargo;
      return yearMatch && monthMatch && analystMatch && cargoMatch;
    });
  }, [shipments, filters]);

  const kpiMetrics = useMemo(() => {
    const totalDIs = new Set(filteredShipments.map(s => s.di).filter(Boolean)).size;
    const totalValue = filteredShipments.reduce((sum: number, s) => sum + (s.invoiceValue || 0), 0);
    
    const clearanceTimes = filteredShipments
        .map(s => calculateDaysBetween(s.cargoPresenceDate, s.greenChannelOrDeliveryAuthorizedDate))
        .filter((days): days is number => days !== null);
    
    const totalClearanceTime = clearanceTimes.reduce((sum: number, days: number) => sum + days, 0);
    const avgClearance = clearanceTimes.length > 0 ? totalClearanceTime / clearanceTimes.length : 0;
    
    const analystCount = new Set(filteredShipments.map(s => s.technicianResponsibleBrazil).filter(Boolean)).size;
    const dIsPerAnalyst = analystCount > 0 ? totalDIs / analystCount : totalDIs;

    return {
        totalDIs,
        totalValue,
        avgClearance: avgClearance.toFixed(1),
        dIsPerAnalyst
    };
  }, [filteredShipments]);
  
    const volumeByTransport = useMemo(() => {
        const groups: { [key: string]: Shipment[] } = { };
        filteredShipments.forEach(s => {
            let type = s.shipmentType || 'Unknown';
            if (!groups[type]) groups[type] = [];
            groups[type].push(s);
        });
        
        if (!groups['FCL']) groups['FCL'] = [];
        if (!groups['LCL']) groups['LCL'] = [];
        if (!groups['FCL/LCL']) groups['FCL/LCL'] = [];
        if (!groups['AIR']) groups['AIR'] = [];
        if (!groups['RO-RO']) groups['RO-RO'] = [];
        if (!groups['GP']) groups['GP'] = [];

        return Object.entries(groups).map(([label, shipments]: [string, Shipment[]]) => ({ label, value: shipments.length, shipments }));
    }, [filteredShipments]);
    
    const avgTimeByIncoterm = useMemo(() => {
        const groups: { [key: string]: { total: number; count: number, shipments: Shipment[] } } = {};
        filteredShipments.forEach(s => {
            if (s.incoterm) {
                const days = calculateDaysBetween(s.actualEtd, s.actualEta);
                if (days !== null) {
                    if (!groups[s.incoterm]) groups[s.incoterm] = { total: 0, count: 0, shipments: [] };
                    groups[s.incoterm].total += days;
                    groups[s.incoterm].count++;
                    groups[s.incoterm].shipments.push(s);
                }
            }
        });
        
        if (!groups['FOB']) groups['FOB'] = { total: 0, count: 0, shipments: []};
        if (!groups['CIF']) groups['CIF'] = { total: 0, count: 0, shipments: []};
        if (!groups['DAP']) groups['DAP'] = { total: 0, count: 0, shipments: []};
        if (!groups['FCA']) groups['FCA'] = { total: 0, count: 0, shipments: []};

        return Object.entries(groups).map(([label, data]: [string, { total: number, count: number, shipments: Shipment[] }]) => ({ 
            label, 
            value: data.count > 0 ? Math.round(data.total / data.count) : 0,
            shipments: data.shipments
        }));
    }, [filteredShipments]);
    
    const diChannelData = useMemo(() => {
        const groups: { [key: string]: { shipments: Shipment[], uniqueDIs: Set<string> } } = {
            'Green': { shipments: [], uniqueDIs: new Set() },
            'Yellow': { shipments: [], uniqueDIs: new Set() },
            'Red': { shipments: [], uniqueDIs: new Set() }
        };

        filteredShipments.forEach(s => {
            if (s.parametrization && groups.hasOwnProperty(s.parametrization)) {
                const group = groups[s.parametrization as keyof typeof groups];
                group.shipments.push(s);
                if (s.di) {
                    group.uniqueDIs.add(s.di);
                }
            }
        });

        return Object.entries(groups).map(([label, data]) => ({
            label,
            value: data.shipments.length,
            secondaryValue: data.uniqueDIs.size,
            shipments: data.shipments,
            color: { 'Green': '#28a745', 'Yellow': '#ffc107', 'Red': '#dc3545' }[label as 'Green' | 'Yellow' | 'Red']
        }));
    }, [filteredShipments]);


  return (
    <div className="brokerage-kpi-page">
      <div className="kpi-content">
        <header className="kpi-page-header">
            <h1>Brokerage KPIs</h1>
            <h2>Performance metrics for brokerage operations</h2>
        </header>

        <BrokerageKPIFilter shipments={shipments} activeFilters={filters} onFilterChange={handleFilterChange} />

        <div className="brokerage-dashboard-layout">
            <section className="brokerage-metrics-row">
                <KPIMetricCard icon={<span className="material-symbols-outlined">receipt_long</span>} title="Total DIs Registered" value={kpiMetrics.totalDIs} />
                <KPIMetricCard icon={<span className="material-symbols-outlined">group</span>} title="DIs per Analyst" value={kpiMetrics.dIsPerAnalyst.toFixed(1)} />
                <KPIMetricCard icon={<span className="material-symbols-outlined">event_available</span>} title="Avg. Clearance Time" value={`${kpiMetrics.avgClearance} days`} />
            </section>

            <section className="brokerage-charts-grid">
                 <div className="chart-wrapper-full">
                    <HorizontalBarChart 
                        title="Volume by Transport Modal" 
                        data={volumeByTransport} 
                        onBarClick={handleChartClick} 
                        colorMap={{
                            'FCL': '#007bff',
                            'LCL': '#28a745',
                            'FCL/LCL': '#6f42c1',
                            'Unknown': '#6db7ff',
                            'AIR': '#17a2b8',
                            'RO-RO': '#fd7e14',
                            'GP': '#adb5bd'
                        }} 
                    />
                </div>
                <div className="chart-wrapper-full">
                     <HorizontalBarChart 
                        title="Avg. Transit Time by Incoterm" 
                        data={avgTimeByIncoterm} 
                        onBarClick={handleChartClick} 
                        colorMap={{
                            'FOB': '#007bff',
                            'CIF': '#28a745',
                            'DAP': '#ffc107',
                            'FCA': '#6db7ff',
                            'EXW': '#dc3545'
                        }} 
                     />
                </div>
                 <div className="chart-wrapper-full">
                    <DoughnutChart title="DI Channel Parameterization" data={diChannelData} onSegmentClick={handleChartClick} strokeWidth={15} size={150} />
                 </div>
            </section>
        </div>

        {selectedShipments && (
            <ShipmentsTable 
                title={selectedShipments.title} 
                shipments={selectedShipments.data} 
                onClose={() => setSelectedShipments(null)} 
            />
        )}
      </div>
    </div>
  );
};

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (shipments: Shipment[]) => Promise<void>;
}

const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose, onUpload }) => {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setError('');
    setSuccess('');
  };

  const handleUpload = () => {
    if (!file) {
      setError('Please select a file first.');
      return;
    }
    setIsUploading(true);
    setError('');
    setSuccess('');

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        const headers = json[0] as string[];
        const rows = json.slice(1);

        const shipmentsToUpload = rows.map((rowArray, index) => {
            const row = rowArray as any[];
            let shipment: Partial<Shipment> = { id: `row-${index}` };
            headers.forEach((header, i) => {
                const key = header.toLowerCase().replace(/\s+/g, '');
                const value = row[i];
                if (key.includes('bl')) shipment.blAwb = value;
                if (key.includes('description') || key.includes('cargo')) shipment.typeOfCargo = value;
                if (key.includes('costcenter')) shipment.costCenter = value;
                if (key.includes('status')) shipment.status = value;
                if (key.includes('eta')) shipment.actualEta = parseDateFromExcel(value);
                if (key.includes('etd')) shipment.actualEtd = parseDateFromExcel(value);
                if (key.includes('incoterm')) shipment.incoterm = value;
                if (key.includes('posap')) shipment.poSap = value;
                if (key.includes('approveddraftdi')) shipment.approvedDraftDi = value;
                if (key.includes('bondedwarehouse')) shipment.bondedWarehouse = value;
                if (key.includes('fcl')) shipment.fcl = typeof value === 'number' ? value : 0;
                if (key.includes('invoicevalue')) shipment.invoiceValue = typeof value === 'number' ? value : 0;
                if (key.includes('parametrization')) shipment.parametrization = value;
                if (key.includes('cargopresence')) shipment.cargoPresenceDate = parseDateFromExcel(value);
                if (key.includes('diregistration')) shipment.diRegistrationDate = parseDateFromExcel(value);
                if (key.includes('greenchannel') || key.includes('deliveryauthorized')) shipment.greenChannelOrDeliveryAuthorizedDate = parseDateFromExcel(value);
                if (key.includes('firsttruck')) shipment.firstTruckDelivery = parseDateFromExcel(value);
                if (key.includes('lasttruck')) shipment.lastTruckDelivery = parseDateFromExcel(value);
                if (key.includes('nfissue')) shipment.nfIssueDate = parseDateFromExcel(value);
                if (key.includes('di') && !key.includes('registration') && !key.includes('draft') && !key.includes('cif')) shipment.di = value;
                if (key.includes('uniquedi')) shipment.uniqueDi = value;

            });
            return shipment as Shipment;
        }).filter(s => s.blAwb);

        await onUpload(shipmentsToUpload);

        setSuccess(`${shipmentsToUpload.length} shipments processed successfully!`);
        setFile(null);

      } catch (err) {
        console.error(err);
        setError('Failed to process the Excel file. Please check the format.');
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };
  
   const resetState = () => {
        setFile(null);
        setIsUploading(false);
        setError('');
        setSuccess('');
    };

    const handleClose = () => {
        resetState();
        onClose();
    };


  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
        <div className="modal-header">
            <h3>Upload Shipments</h3>
            <button onClick={handleClose}><span className="material-symbols-outlined">close</span></button>
        </div>
        <div className="modal-body">
            {error && <div className="error-banner">{error}</div>}
            {success && <div className="success-banner">{success}</div>}
            
            <div className="file-drop-area"
                onClick={() => fileInputRef.current.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); setFile(e.dataTransfer.files[0]); }}
            >
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" style={{ display: 'none' }} />
                {file ? (
                    <p>Selected file: {file.name}</p>
                ) : (
                    <>
                        <span className="material-symbols-outlined">cloud_upload</span>
                        <p>Drag & drop your Excel file here, or click to select.</p>
                    </>
                )}
            </div>
        </div>
        <div className="modal-actions-footer">
            <button className="btn-secondary" onClick={handleClose}>Cancel</button>
            <button className="btn-primary" onClick={handleUpload} disabled={!file || isUploading}>
                {isUploading ? <LoadingSpinner/> : 'Upload'}
            </button>
        </div>
    </Modal>
  );
};

const ImportsPage = ({ shipments, isLoading, error, onUpload, initialFilters }: { shipments: Shipment[], isLoading: boolean, error: string, onUpload: (data: Shipment[]) => Promise<void>, initialFilters: any }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [statusFilter, setStatusFilter] = useState(initialFilters?.statusFilter || 'All');
    const [searchTerm, setSearchTerm] = useState('');
    const [isUploadModalOpen, setUploadModalOpen] = useState(false);

    useEffect(() => {
        if (initialFilters?.statusFilter) {
            setStatusFilter(initialFilters.statusFilter);
        }
    }, [initialFilters]);

    const filteredShipments = useMemo(() => {
        return shipments.filter(s => {
            const matchesSearch = searchTerm === '' ||
                (s.blAwb && s.blAwb.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (s.description && s.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (s.typeOfCargo && s.typeOfCargo.toLowerCase().includes(searchTerm.toLowerCase()));
            
            const matchesStatus = statusFilter === 'All' || s.status === statusFilter;

            return matchesSearch && matchesStatus;
        });
    }, [shipments, searchTerm, statusFilter]);

    return (
        <div className="imports-page">
            <div className="page-header">
                <h1>Imports</h1>
                <div className="header-actions">
                    <button className="btn-primary" onClick={() => setUploadModalOpen(true)}>
                        <span className="material-symbols-outlined">cloud_upload</span> Upload Excel
                    </button>
                </div>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="imports-filters" style={{display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center'}}>
                <div className="search-bar-container" style={{marginBottom: 0, height: 'auto', padding: '0.5rem 1rem', flex: 1}}>
                    <span className="material-symbols-outlined">search</span>
                    <input
                        type="text"
                        placeholder="Search by BL, Description..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="search-input"
                    />
                </div>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="status-select" style={{padding: '0.5rem', borderRadius: '0.75rem', border: '1px solid var(--border-color)', height: '100%'}}>
                    <option value="All">All Statuses</option>
                    {Object.values(ImportStatus).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <span className="record-count" style={{marginLeft: '1rem', fontSize: '0.9rem', color: 'var(--text-muted)'}}>{filteredShipments.length} records found</span>
            </div>

            {isLoading ? <LoadingSpinner /> : (
                <div className="table-responsive">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>BL/AWB</th>
                                <th>Status</th>
                                <th>Cargo</th>
                                <th>ETA</th>
                                <th>Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredShipments.map((s) => (
                                <tr key={s.id}>
                                    <td>
                                        <span className="bl-cell" style={{fontWeight: 600}}>{s.blAwb}</span>
                                        {s.poSap && <div className="po-sub" style={{fontSize: '0.8em', opacity: 0.7}}>{s.poSap}</div>}
                                    </td>
                                    <td>
                                        <span className={`status-badge status-${(s.status || '').replace(/\s+/g, '-').toLowerCase()}`}>
                                            {s.status}
                                        </span>
                                    </td>
                                    <td>{s.typeOfCargo}</td>
                                    <td>{formatDate(s.actualEta)}</td>
                                    <td>{(s.invoiceValue || 0).toLocaleString('en-US', { style: 'currency', currency: s.invoiceCurrency || 'USD' })}</td>
                                </tr>
                            ))}
                            {filteredShipments.length === 0 && (
                                <tr>
                                    <td colSpan={5} style={{textAlign: 'center', padding: '2rem'}}>No shipments found</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
             <UploadModal isOpen={isUploadModalOpen} onClose={() => setUploadModalOpen(false)} onUpload={onUpload} />
        </div>
    );
};

const App = () => {
    const [user, setUser] = useState<firebase.User | null>(null);
    const [userData, setUserData] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
    
    const [activePage, setActivePage] = useState('Dashboard');
    const [pageState, setPageState] = useState({});

    const [shipments, setShipments] = useState<Shipment[]>([]);
    const [dataLoading, setDataLoading] = useState(true);
    const [dataError, setDataError] = useState('');

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
            if (firebaseUser) {
                setUser(firebaseUser);
                const userDoc = await firestore.collection('users').doc(firebaseUser.uid).get();
                if (userDoc.exists) {
                    setUserData(userDoc.data() as User);
                } else {
                    setUserData({ id: firebaseUser.uid, name: firebaseUser.displayName || 'New User', username: firebaseUser.email || '', role: 'COMEX' });
                }
            } else {
                setUser(null);
                setUserData(null);
            }
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const fetchShipments = async () => {
            if (!user) return;
            setDataLoading(true);
            setDataError('');
            try {
                const snapshot = await firestore.collection('shipments').get();
                const shipmentsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Shipment[];
                setShipments(shipmentsData);
            } catch (err) {
                console.error("Error fetching shipments:", err);
                setDataError('Failed to load shipment data.');
            } finally {
                setDataLoading(false);
            }
        };
        fetchShipments();
    }, [user]);

    const handleUploadShipments = async (newShipments: Shipment[]) => {
        const batch = firestore.batch();
        
        newShipments.forEach(shipment => {
            const docRef = firestore.collection('shipments').doc(shipment.blAwb.replace(/\//g, '-'));
            batch.set(docRef, shipment, { merge: true });
        });

        await batch.commit();

        const snapshot = await firestore.collection('shipments').get();
        const shipmentsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Shipment[];
        setShipments(shipmentsData);
    };
    
    const handleNavigate = (page: string, state: object = {}) => {
        setActivePage(page);
        setPageState(state);
    }

    if (isLoading) {
        return <LoadingSpinner />;
    }

    if (!user) {
        return <LoginPage onLoginSuccess={() => {}} />;
    }

    const renderPage = () => {
        switch (activePage) {
            case 'Dashboard':
                return <DashboardPage shipments={shipments} onNavigate={handleNavigate}/>;
            case 'Imports':
                return <ImportsPage shipments={shipments} isLoading={dataLoading} error={dataError} onUpload={handleUploadShipments} initialFilters={pageState} />;
            case 'KPIs':
                return <KPIsPage shipments={shipments} />;
            case 'Brokerage KPIs':
                return <BrokerageKPIsPage shipments={shipments} />;
            default:
                return <div>Page not found</div>;
        }
    };
    
    const navItems = [
        { name: 'Dashboard', icon: 'dashboard' },
        { name: 'Imports', icon: 'directions_boat' },
        { name: 'KPIs', icon: 'bar_chart' },
        { name: 'Brokerage KPIs', icon: 'pie_chart' },
    ];

    return (
        <div className={'app-container ' + (isSidebarCollapsed ? 'sidebar-collapsed' : '')}>
             <aside className={'sidebar ' + (isSidebarCollapsed ? 'collapsed' : '')}>
                <div>
                    <header className="sidebar-header">
                        <span>Navigator</span>
                         {!isSidebarCollapsed && (
                             <button className="sidebar-toggle" onClick={() => setSidebarCollapsed(true)} aria-label="Collapse sidebar">
                                <span className="material-symbols-outlined">menu_open</span>
                            </button>
                         )}
                    </header>
                    <nav>
                        <ul className="nav-links">
                            {navItems.map(item => (
                                <li key={item.name}>
                                    <a
                                        href="#"
                                        className={'nav-link ' + (activePage === item.name ? 'active' : '')}
                                        onClick={(e) => { e.preventDefault(); handleNavigate(item.name); }}
                                        title={item.name}
                                    >
                                        <span className="material-symbols-outlined nav-icon">{item.icon}</span>
                                        <span className="nav-label">{item.name}</span>
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </div>
                <footer className="sidebar-footer">
                     {isSidebarCollapsed ? (
                        <button className="sidebar-toggle" onClick={() => setSidebarCollapsed(false)} aria-label="Expand sidebar">
                            <span className="material-symbols-outlined">menu</span>
                        </button>
                    ) : (
                        <div style={{display: 'flex', flexDirection: 'column'}}>
                            <div className="user-info">
                                <div className="user-avatar" style={{width: '32px', height: '32px', borderRadius: '50%', background: 'var(--primary-color)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px'}}>
                                    {userData?.name?.charAt(0).toUpperCase()}
                                </div>
                                <div className="user-details">
                                    <span className="user-name">{userData?.name}</span>
                                    <span className="user-role">{userData?.role}</span>
                                </div>
                            </div>
                            <a href="#" className="nav-link" onClick={() => auth.signOut()} style={{marginTop: '0.5rem'}}>
                                <span className="material-symbols-outlined nav-icon">logout</span>
                                <span className="nav-label">Logout</span>
                            </a>
                        </div>
                    )}
                </footer>
            </aside>
            <main className="main-content">
                {renderPage()}
            </main>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);