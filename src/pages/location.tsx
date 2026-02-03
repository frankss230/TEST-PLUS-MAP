'use client'
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/router'
import axios from 'axios'

import { GoogleMap, Marker, useLoadScript, InfoWindow, DrawingManager, Polygon, Circle, DirectionsRenderer } from '@react-google-maps/api';
import Spinner from 'react-bootstrap/Spinner';

import styles from '@/styles/page.module.css'
import { encrypt } from '@/utils/helpers'

interface Location {
    latitude: number;
    longitude: number;
}
interface DataUserState {
    isLogin: boolean;
    userData: any | null
    takecareData: any | null
}

const Location = () => {
    const router = useRouter();
    // const { loadScript } = useLoadScript();
    const { isLoaded } = useLoadScript({
        googleMapsApiKey: process.env.GoogleMapsApiKey as string
    });
    const containerStyle = {
        width: '100vw',
        height: '100vh'
    };

    const mapRef = useRef<google.maps.Map | null>(null);
    const [userInteracted, setUserInteracted] = useState(false);

    const [infoWindowData, setInfoWindowData] = useState({ id: 0, address: '', show: false });
    const [fallEvent, setFallEvent] = useState<{ show: boolean; lat: number; lng: number } | null>(null);
    const [alert, setAlert] = useState({ show: false, message: '' });
    const [isLoading, setLoading] = useState(true);
    const [dataUser, setDataUser] = useState<DataUserState>({ isLogin: false, userData: null, takecareData: null })
    const [directions, setDirections] = useState<any | null>(null);
    const [range1, setRange1] = useState(10)
    const [range2, setRange2] = useState(20)


    const [origin, setOrigin] = useState({ lat: 0, lng: 0 }); // Default origin (Safezone)
    const [destination, setDestination] = useState({ lat: 0, lng: 0 }); // Default destination (ผู้สูงอายุ)
    const [caretaker, setCaretaker] = useState<{ lat: number; lng: number } | null>(null); // ตำแหน่งผู้ดูแล (local)
    const [caretakerRemote, setCaretakerRemote] = useState<{ lat: number; lng: number } | null>(null); // ตำแหน่งผู้ดูแล (ล่าสุดจาก backend)
    const pollingRef = useRef<NodeJS.Timeout | null>(null);
    const caretakerPollingRef = useRef<NodeJS.Timeout | null>(null);

    const onMapLoad = useCallback((map: google.maps.Map) => {
        mapRef.current = map;
        map.addListener('dragstart', () => setUserInteracted(true));
        map.addListener('zoom_changed', () => setUserInteracted(true));
    }, []);

    const onMapUnmount = useCallback(() => {
        mapRef.current = null;
        setUserInteracted(false);
    }, []);

    const alertModal = useCallback(() => {
        setAlert({ show: true, message: 'ระบบไม่สามารถดึงข้อมูลของท่านได้ กรุณาลองใหม่อีกครั้ง' })
        setDataUser({ isLogin: false, userData: null, takecareData: null })
    }, []);

    // ดึงตำแหน่งผู้ดูแลล่าสุดจาก backend
    const fetchCaretakerRemote = useCallback(async (userData: any, takecareData: any) => {
        if (!userData || !takecareData) return;
        try {
            const res = await axios.get(`/api/caretakerLocation?users_id=${userData.users_id}&takecare_id=${takecareData.takecare_id}`);
            if (res.data?.data) {
                setCaretakerRemote({
                    lat: Number(res.data.data.locat_latitude),
                    lng: Number(res.data.data.locat_longitude),
                });
            }
        } catch (e) {
            // ignore
        }
    }, []);

    const sendFallNotification = useCallback(async (lat: number, lng: number) => {
        if (!dataUser.userData || !dataUser.takecareData) {
            console.error('Cannot send fall notification: user data is missing.');
            return;
        }
        try {
            await axios.post(`${process.env.WEB_DOMAIN}/api/line/notifyFall`, {
                users_id: dataUser.userData.users_id,
                takecare_id: dataUser.takecareData.takecare_id,
                lat: lat,
                lng: lng,
            });
        } catch (error) {
            console.error("Failed to send fall notification", error);
            setAlert({ show: true, message: 'เกิดข้อผิดพลาดในการส่งการแจ้งเตือนฉุกเฉิน' });
        }
    }, [dataUser.userData, dataUser.takecareData]);

    const onGetLocation = useCallback(async (safezoneData: any, takecareData: any, userData: any, silent = false) => {
        try {
            const resLocation = await axios.get(`${process.env.WEB_DOMAIN}/api/location/getLocation?takecare_id=${takecareData.takecare_id}&users_id=${userData.users_id}&safezone_id=${safezoneData.safezone_id}&location_id=${router.query.idlocation}`);
            if (resLocation.data?.data) {
                const data = resLocation.data?.data
                setDestination({
                    lat: Number(data.locat_latitude),
                    lng: Number(data.locat_longitude),
                });
            } else {
                setDestination({
                    lat: Number(safezoneData.safez_latitude),
                    lng: Number(safezoneData.safez_longitude),
                });
            }

            // --- NEW: Check for fall event ---
            // This assumes the API response includes a boolean `is_fall` field.
            if (resLocation.data?.data?.is_fall) {
                const fallLat = Number(resLocation.data.data.locat_latitude);
                const fallLng = Number(resLocation.data.data.locat_longitude);
                // Show alert modal
                setFallEvent({
                    show: true,
                    lat: fallLat,
                    lng: fallLng,
                });
                // Stop polling to prevent the modal from re-appearing.
                if (pollingRef.current) clearInterval(pollingRef.current);
                if (caretakerPollingRef.current) clearInterval(caretakerPollingRef.current);
            }
            if (!silent) setLoading(false)
        } catch (error) {
            setDataUser({ isLogin: false, userData: null, takecareData: null })
            setAlert({ show: true, message: 'ระบบไม่สามารถดึงข้อมูล Safezone ของท่านได้ กรุณาลองใหม่อีกครั้ง' })
            setLoading(false)
        }
    }, [router.query.idlocation]);

    // Polling ดึงตำแหน่งล่าสุดทุก 5 วินาที
    const startPollingLocation = useCallback((safezoneData: any, takecareData: any, userData: any) => {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = setInterval(() => {
            onGetLocation(safezoneData, takecareData, userData, true);
        }, 3000);
        // Polling ตำแหน่งผู้ดูแล (remote) ทุก 3 วินาที
        if (caretakerPollingRef.current) clearInterval(caretakerPollingRef.current);
        caretakerPollingRef.current = setInterval(() => {
            fetchCaretakerRemote(userData, takecareData);
        }, 3000);
    }, [fetchCaretakerRemote, onGetLocation]);

    const onGetSafezone = useCallback(async (idSafezone: string, takecareData: any, userData: any) => {
        try {
            const resSafezone = await axios.get(`${process.env.WEB_DOMAIN}/api/setting/getSafezone?takecare_id=${takecareData.takecare_id}&users_id=${userData.users_id}&id=${idSafezone}`);
            if (resSafezone.data?.data) {
                const data = resSafezone.data?.data
                setOrigin({
                    lat: Number(data.safez_latitude),
                    lng: Number(data.safez_longitude),
                });
                setRange1(data.safez_radiuslv1)
                setRange2(data.safez_radiuslv2)
                onGetLocation(data, takecareData, userData)
                startPollingLocation(data, takecareData, userData);
            }
        } catch (error) {
            setDataUser({ isLogin: false, userData: null, takecareData: null })
            setAlert({ show: true, message: 'ระบบไม่สามารถดึงข้อมูล Safezone ของท่านได้ กรุณาลองใหม่อีกครั้ง' })
            setLoading(false)
        }
    }, [onGetLocation, startPollingLocation]);

    // ====== ย้าย onGetUserData มาไว้ตรงนี้ ======
    const onGetUserData = useCallback(async (auToken: string) => {
        try {
            const responseUser = await axios.get(`${process.env.WEB_DOMAIN}/api/user/getUser/${auToken}`);
            if (responseUser.data?.data) {
                const encodedUsersId = encrypt(responseUser.data?.data.users_id.toString());
                const responseTakecareperson = await axios.get(`${process.env.WEB_DOMAIN}/api/user/getUserTakecareperson/${encodedUsersId}`);
                const data = responseTakecareperson.data?.data
                if (data) {
                    setDataUser({ isLogin: false, userData: responseUser.data?.data, takecareData: data })
                    onGetSafezone(router.query.idsafezone as string, data, responseUser.data?.data)
                } else {
                    alertModal()
                }
            } else {
                alertModal()
            }
        } catch (error) {
            setDataUser({ isLogin: false, userData: null, takecareData: null })
            setAlert({ show: true, message: 'ระบบไม่สามารถดึงข้อมูลของท่านได้ กรุณาลองใหม่อีกครั้ง' })
            setLoading(false)
        }
    }, [router.query.idsafezone, onGetSafezone, alertModal]);
    // ====== จบย้าย ======

    // Polling ตำแหน่งผู้สูงอายุและผู้ดูแลแบบเรียลไทม์
    useEffect(() => {
        const auToken = router.query.auToken
        if (auToken && isLoaded) {
            onGetUserData(auToken as string)
        }
        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
            if (caretakerPollingRef.current) clearInterval(caretakerPollingRef.current);
        };
    }, [router.query.auToken, isLoaded, onGetUserData]);

    // ส่งตำแหน่งผู้ดูแลไป backend ทุกครั้งที่ caretaker (local) เปลี่ยน
    useEffect(() => {
        if (!caretaker || !dataUser.userData || !dataUser.takecareData) return;
        const sendCaretakerLocation = async () => {
            try {
                await axios.post('/api/caretakerLocation', {
                    users_id: dataUser.userData.users_id,
                    takecare_id: dataUser.takecareData.takecare_id,
                    latitude: caretaker.lat,
                    longitude: caretaker.lng,
                });
            } catch (e) {
                // ignore
            }
        };
        sendCaretakerLocation();
    }, [caretaker, dataUser.userData, dataUser.takecareData]);

    useEffect(() => {
        // Only calculate route when we have valid coordinates for both origin and destination
        if (isLoaded && origin.lat !== 0 && destination.lat !== 0) {
            const directionsService = new window.google.maps.DirectionsService();

            directionsService.route(
                {
                    origin: new window.google.maps.LatLng(origin.lat, origin.lng),
                    destination: new window.google.maps.LatLng(destination.lat, destination.lng),
                    travelMode: window.google.maps.TravelMode.DRIVING,
                },
                (result, status) => {
                    if (status === window.google.maps.DirectionsStatus.OK && result) {
                        setDirections(result);
                    } else {
                        console.error(`Directions request failed due to ${status}`);
                        setDirections(null); // Clear the route if it fails
                    }
                }
            );
        } else {
            setDirections(null); // Clear directions if coordinates are not valid
        }
    }, [origin, destination, isLoaded]);
    // Geolocation API: ตำแหน่งผู้ดูแล (Caretaker)
    useEffect(() => {
        let geoWatchId: number | null = null;
        if (navigator.geolocation) {
            geoWatchId = navigator.geolocation.watchPosition(
                (pos) => {
                    setCaretaker({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                },
                (err) => {
                    // ไม่อนุญาตหรือ error
                },
                { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
            );
        }
        return () => {
            if (geoWatchId !== null && navigator.geolocation) {
                navigator.geolocation.clearWatch(geoWatchId);
            }
        };
    }, []);

    useEffect(() => {
        if (!mapRef.current || userInteracted || !isLoaded) return;
        if (destination.lat === 0 && destination.lng === 0) return;

        const bounds = new window.google.maps.LatLngBounds();

        bounds.extend({ lat: destination.lat, lng: destination.lng });
        bounds.extend({ lat: origin.lat, lng: origin.lng });

        if (caretaker) {
            bounds.extend({ lat: caretaker.lat, lng: caretaker.lng });
        }
        if (caretakerRemote) {
            bounds.extend({ lat: caretakerRemote.lat, lng: caretakerRemote.lng });
        }

        if (!bounds.isEmpty()) {
            if (!bounds.getNorthEast().equals(bounds.getSouthWest())) {
                mapRef.current.fitBounds(bounds, 100); // padding
            } else {
                mapRef.current.setCenter(bounds.getCenter());
                mapRef.current.setZoom(15);
            }
        }
    }, [isLoaded, destination, origin, caretaker, caretakerRemote, userInteracted]);

    const handleMarkerClick = (id: number, lat: number, lng: number, address: string) => {
        mapRef.current?.panTo({ lat, lng });
        setInfoWindowData({ id, address, show: true });
    };
    const polygonOptions = {
        strokeColor: "yellow",
        strokeOpacity: 0.5,
        strokeWeight: 3.0,
        fillColor: "red",
        fillOpacity: 0.2,
    };

    const handleRequestHelp = async () => {
        if (!fallEvent) return;

        await sendFallNotification(fallEvent.lat, fallEvent.lng);
        setAlert({ show: true, message: 'ส่งแจ้งเตือนฉุกเฉินไปยัง LINE สำเร็จ' });
        setFallEvent(null); // ปิดหน้าต่างหลังจากส่ง
    };

    if ((origin.lat === 0 && origin.lng === 0) || (destination.lat === 0 && destination.lng === 0)) {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ height: '100vh' }}>
                <Spinner animation="border" variant="primary" />
            </div>
        )
    }

    return (
        <>
            {fallEvent?.show && (
                <div className={styles.fallAlertOverlay}>
                    <div className={styles.fallAlertModal}>
                        <div className={styles.fallAlertIcon}>
                            <i className="fas fa-exclamation-triangle fa-3x"></i>
                        </div>
                        <h2>ตรวจพบเหตุฉุกเฉิน!</h2>
                        <p>ระบบตรวจพบการล้มของผู้มีภาวะพึ่งพิง<br />คุณต้องการส่งแจ้งเตือนไปยัง LINE หรือไม่?</p>
                        <div className={styles.fallAlertActions}>
                            <button
                                className="btn btn-danger btn-lg"
                                onClick={handleRequestHelp}
                            >
                                <i className="fab fa-line"></i> ใช่, ส่งแจ้งเตือน
                            </button>
                            <button
                                className="btn btn-secondary mt-2"
                                onClick={() => setFallEvent(null)}
                            >
                                ไม่, ปิดไปก่อน
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {
                !isLoaded ? (
                    <div className="d-flex justify-content-center align-items-center" style={{ height: '100vh' }}>
                        <Spinner animation="border" variant="primary" />
                    </div>
                ) : (
                    <>
                        <GoogleMap
                            clickableIcons={false}
                            mapContainerStyle={containerStyle}
                            onLoad={onMapLoad}
                            onUnmount={onMapUnmount}
                            options={{
                                mapTypeControl: true,
                                streetViewControl: false,
                                zoomControlOptions: {
                                    position: google.maps.ControlPosition.LEFT_CENTER,
                                },
                            }}
                        >
                            {/* Marker ผู้สูงอายุ */}
                            <Marker
                                position={{ lat: destination.lat, lng: destination.lng }}
                                icon={{
                                    url: 'https://maps.google.com/mapfiles/kml/pal2/icon6.png',
                                    scaledSize: new window.google.maps.Size(35, 35)
                                }}
                                onClick={() => {
                                    handleMarkerClick(1, destination.lat, destination.lng, 'ผู้สูงอายุ');
                                }}
                            >
                                {infoWindowData.show && (
                                    <InfoWindow
                                        onCloseClick={() => {
                                            setInfoWindowData({ id: 0, address: '', show: false });
                                        }}
                                    >
                                        <h3>{infoWindowData.address}</h3>
                                    </InfoWindow>
                                )}
                            </Marker>
                            {/* Marker Safezone */}
                            <Marker
                                position={{ lat: origin.lat, lng: origin.lng }}
                                icon={{
                                    url: 'https://maps.google.com/mapfiles/kml/pal2/icon10.png',
                                    scaledSize: new window.google.maps.Size(35, 35),
                                }}
                            >
                                <>
                                    <Circle
                                        center={{ lat: origin.lat, lng: origin.lng }}
                                        radius={range1}
                                        options={{ fillColor: "#F2BE22", strokeColor: "#F2BE22", fillOpacity: 0.2 }}
                                    />
                                    <Circle
                                        center={{ lat: origin.lat, lng: origin.lng }}
                                        radius={range2}
                                        options={{ fillColor: "#F24C3D", strokeColor: "#F24C3D", fillOpacity: 0.1 }}
                                    />
                                </>
                            </Marker>
                            {/* Marker ผู้ดูแล (Caretaker - คุณ) */}
                            {caretaker && (
                                <Marker
                                    position={{ lat: caretaker.lat, lng: caretaker.lng }}
                                    icon={{
                                        url: 'https://maps.google.com/mapfiles/kml/pal2/icon13.png',
                                        scaledSize: new window.google.maps.Size(35, 35),
                                    }}
                                    onClick={() => handleMarkerClick(2, caretaker.lat, caretaker.lng, 'ผู้ดูแล (คุณ)')}
                                >
                                    {infoWindowData.show && infoWindowData.id === 2 && (
                                        <InfoWindow
                                            onCloseClick={() => setInfoWindowData({ id: 0, address: '', show: false })}
                                        >
                                            <h3>{infoWindowData.address}</h3>
                                        </InfoWindow>
                                    )}
                                </Marker>
                            )}
                            {/* Marker ผู้ดูแล (Caretaker - remote/ล่าสุด) */}
                            {caretakerRemote && (
                                <Marker
                                    position={{ lat: caretakerRemote.lat, lng: caretakerRemote.lng }}
                                    icon={{
                                        url: 'https://maps.google.com/mapfiles/kml/pal2/icon15.png',
                                        scaledSize: new window.google.maps.Size(35, 35),
                                    }}
                                    onClick={() => handleMarkerClick(3, caretakerRemote.lat, caretakerRemote.lng, 'ผู้ดูแล (ล่าสุด)')}
                                >
                                    {infoWindowData.show && infoWindowData.id === 3 && (
                                        <InfoWindow
                                            onCloseClick={() => setInfoWindowData({ id: 0, address: '', show: false })}
                                        >
                                            <h3>{infoWindowData.address}</h3>
                                        </InfoWindow>
                                    )}
                                </Marker>
                            )}
                            {directions && <DirectionsRenderer directions={directions} />}
                        </GoogleMap>
                        <div className={styles.buttonLayout}>
                            {dataUser.takecareData?.takecare_tel1 && (
                                <a className={`btn btn-primary ${styles.button}`} href={`tel:${dataUser.takecareData?.takecare_tel1}`}> โทรหาผู้สูงอายุ <i className="fas fa-phone"></i> </a>
                            )}
                            <button className={`btn btn-info ${styles.button}`} onClick={() => setUserInteracted(false)}>
                                จัดกลาง <i className="fas fa-crosshairs"></i>
                            </button>
                        </div>
                    </>
                )
            }
        </>
    )
}

export default Location