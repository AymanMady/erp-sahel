//! Direct printing to a ticket printer, without the system print window.
//!
//! The web application builds the ticket (ESC/POS bytes, the picture of the ticket
//! included); this module only carries the bytes to the printer. Three kinds of target:
//!  - `tcp://192.168.1.50:9100` — network printer (port 9100 when left out);
//!  - `\\localhost\TICKET` — Windows: USB printer shared under the name `TICKET`;
//!  - `/dev/usb/lp0` — Linux: USB printer (the user must be in the `lp` group).

use std::fs::OpenOptions;
use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const WRITE_TIMEOUT: Duration = Duration::from_secs(15);
const DEFAULT_PORT: u16 = 9100;

#[tauri::command]
pub async fn printer_send(target: String, data: Vec<u8>) -> Result<(), String> {
    // Blocking I/O (a network printer may take seconds to answer): off the main thread.
    tauri::async_runtime::spawn_blocking(move || send(target.trim(), &data))
        .await
        .map_err(|error| error.to_string())?
}

fn send(target: &str, data: &[u8]) -> Result<(), String> {
    if target.is_empty() {
        return Err("No printer configured".to_string());
    }
    match target.strip_prefix("tcp://") {
        Some(address) => send_network(address, data),
        None => send_device(target, data),
    }
}

fn send_network(address: &str, data: &[u8]) -> Result<(), String> {
    let with_port = if address.contains(':') {
        address.to_string()
    } else {
        format!("{address}:{DEFAULT_PORT}")
    };
    let socket = with_port
        .to_socket_addrs()
        .map_err(|error| error.to_string())?
        .next()
        .ok_or_else(|| format!("Unknown printer address: {address}"))?;
    let mut stream =
        TcpStream::connect_timeout(&socket, CONNECT_TIMEOUT).map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(WRITE_TIMEOUT))
        .map_err(|error| error.to_string())?;
    stream.write_all(data).map_err(|error| error.to_string())?;
    stream.flush().map_err(|error| error.to_string())
}

fn send_device(path: &str, data: &[u8]) -> Result<(), String> {
    let mut device = OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    device.write_all(data).map_err(|error| error.to_string())?;
    device.flush().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;

    #[test]
    fn sends_the_bytes_to_a_network_printer() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let reader = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut received = Vec::new();
            socket.read_to_end(&mut received).unwrap();
            received
        });
        send(&format!("tcp://{address}"), b"\x1b@hello").unwrap();
        assert_eq!(reader.join().unwrap(), b"\x1b@hello");
    }

    #[test]
    fn writes_to_a_device_file() {
        let path = std::env::temp_dir().join(format!("erp-printer-{}", std::process::id()));
        std::fs::write(&path, b"").unwrap();
        send(path.to_str().unwrap(), b"ticket").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"ticket");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn refuses_an_empty_target() {
        assert!(send("", b"x").is_err());
    }
}
