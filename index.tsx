
    const statusByContainersData = useMemo(() => {
        const groups: { [key: string]: { shipments: Shipment[], count: number } } = {
            'IN TRANSIT': {shipments: [], count: 0}, 
            'AT THE PORT': {shipments: [], count: 0}, 
            'DI REGISTERED': {shipments: [], count: 0}, 
            'CARGO CLEARED': {shipments: [], count: 0},
            'CARGO DELIVERED': {shipments: [], count: 0}
        };
        filteredShipments.forEach(s => {
            const containerCount = (s.shipmentType === 'FCL' || s.shipmentType === 'FCL/LCL') ? (s.fcl || 1) : 0;
            if (s.status && groups.hasOwnProperty(s.status)) {
                groups[s.status].count += containerCount;
                groups[s.status].shipments.push(s);
            } else if (s.status === ImportStatus.CargoReady) {
                groups['AT THE PORT'].count += containerCount;
                groups['AT THE PORT'].shipments.push(s);
            }
        });
        return Object.entries(groups).map(([label, data]) => ({
            label, value: Math.round(data.count), shipments: data.shipments,
            color: { 
                'IN TRANSIT': '#3b82f6', 
                'AT THE PORT': '#f97316', 
                'DI REGISTERED': '#facc15', 
                'CARGO CLEARED': '#10b981',
                'CARGO DELIVERED': '#8b5cf6'
            }[label]
        }));
    }, [filteredShipments]);
