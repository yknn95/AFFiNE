import Capacitor
import Foundation

@objc(NbStorePlugin)
public class NbStorePlugin: CAPPlugin, CAPBridgedPlugin {
    private let docStoragePool: DocStoragePool = .init(noPointer: DocStoragePool.NoPointer())

    public let identifier = "NbStorePlugin"
    public let jsName = "NbStoreDocStorage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getSpaceDBPath", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isClosed", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkpoint", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "validate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSpaceId", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDocSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDocSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDocUpdates", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "markUpdatesMerged", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteDoc", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDocClocks", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDocClock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getBlob", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBlob", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteBlob", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "releaseBlobs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listBlobs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPeerRemoteClocks", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPeerRemoteClock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPeerRemoteClock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPeerPulledRemoteClocks", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPeerPulledRemoteClock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPeerPulledRemoteClock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPeerPushedClocks", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPeerPushedClock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearClocks", returnType: CAPPluginReturnPromise),
    ]

    @objc func getSpaceDBPath(_ call: CAPPluginCall) {
        let peer = call.getString("peer") ?? ""
        let spaceType = call.getString("spaceType") ?? ""
        let id = call.getString("id") ?? ""

        do {
            let path = try getDbPath(peer: peer, spaceType: spaceType, id: id)
            call.resolve(["path": path])
        } catch {
            call.reject("Failed to get space DB path", nil, error)
        }
    }

    @objc func connect(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        try? await docStoragePool.connect(universalId: id)
    }

    @objc func close(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        try? await docStoragePool.close(universalId: id)
    }

    @objc func isClosed(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        call.resolve(["isClosed": docStoragePool.isClosed(universalId: id)])
    }

    @objc func checkpoint(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        try? await docStoragePool.checkpoint(universalId: id)
    }

    @objc func validate(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let validate = (try? await docStoragePool.validate(universalId: id)) ?? false
        call.resolve(["isValidate": validate])
    }

    @objc func setSpaceId(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let spaceId = call.getString("spaceId") ?? ""
        do {
            try await docStoragePool.setSpaceId(universalId: id, spaceId: spaceId)
            call.resolve()
        } catch {
            call.reject("Failed to set space id", nil, error)
        }
    }

    @objc func pushUpdate(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let docId = call.getString("docId") ?? ""
        let data = call.getString("data") ?? ""
        do {
            let timestamp = try await docStoragePool.pushUpdate(universalId: id, docId: docId, update: data)
            call.resolve(["timestamp": timestamp.timeIntervalSince1970])

        } catch {
            call.reject("Failed to push update", nil, error)
        }
    }

    @objc func getDocSnapshot(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let docId = call.getString("docId") ?? ""
        do {
            if let record = try await docStoragePool.getDocSnapshot(universalId: id, docId: docId) {
                call.resolve([
                    "docId": record.docId,
                    "data": record.data,
                    "timestamp": record.timestamp.timeIntervalSince1970,
                ])
            } else {
                call.resolve()
            }
        } catch {
            call.reject("Failed to get doc snapshot", nil, error)
        }
    }

    @objc func setDocSnapshot(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let docId = call.getString("docId") ?? ""
        let data = call.getString("data") ?? ""
        let timestamp = Date()
        do {
            let success = try await docStoragePool.setDocSnapshot(
                universalId: id,
                snapshot: DocRecord(docId: docId, data: data, timestamp: timestamp)
            )
            call.resolve(["success": success])
        } catch {
            call.reject("Failed to set doc snapshot", nil, error)
        }
    }

    @objc func getDocUpdates(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let docId = call.getString("docId") ?? ""
        do {
            let updates = try await docStoragePool.getDocUpdates(universalId: id, docId: docId)
            let mapped = updates.map { [
                "docId": $0.docId,
                "createdAt": $0.createdAt.timeIntervalSince1970,
                "data": $0.data,
            ] }
            call.resolve(["updates": mapped])
        } catch {
            call.reject("Failed to get doc updates", nil, error)
        }
    }

    @objc func markUpdatesMerged(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let docId = call.getString("docId") ?? ""
        let times = call.getArray("timestamps", Double.self) ?? []
        let dateArray = times.map { Date(timeIntervalSince1970: $0) }
        do {
            let count = try await docStoragePool.markUpdatesMerged(universalId: id, docId: docId, updates: dateArray)
            call.resolve(["count": count])
        } catch {
            call.reject("Failed to mark updates merged", nil, error)
        }
    }

    @objc func deleteDoc(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let docId = call.getString("docId") ?? ""
        do {
            try await docStoragePool.deleteDoc(universalId: id, docId: docId)
            call.resolve()
        } catch {
            call.reject("Failed to delete doc", nil, error)
        }
    }

    @objc func getDocClocks(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let after = call.getInt("after")
        do {
            let docClocks = try await docStoragePool.getDocClocks(
                universalId: id,
                after: after != nil ? Date(timeIntervalSince1970: TimeInterval(after!)) : nil
            )
            let mapped = docClocks.map { [
                "docId": $0.docId,
                "timestamp": $0.timestamp.timeIntervalSince1970,
            ] }
            call.resolve(["clocks": mapped])
        } catch {
            call.reject("Failed to get doc clocks", nil, error)
        }
    }

    @objc func getDocClock(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let docId = call.getString("docId") ?? ""
        do {
            if let docClock = try await docStoragePool.getDocClock(universalId: id, docId: docId) {
                call.resolve([
                    "docId": docClock.docId,
                    "timestamp": docClock.timestamp.timeIntervalSince1970,
                ])
            } else {
                call.resolve()
            }
        } catch {
            call.reject("Failed to get doc clock for docId: \(docId)", nil, error)
        }
    }

    @objc func getBlob(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let key = call.getString("key") ?? ""
        if let blob = try? await docStoragePool.getBlob(universalId: id, key: key) {
            call.resolve(["blob": blob])
        } else {
            call.resolve()
        }
    }

    @objc func setBlob(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let key = call.getString("key") ?? ""
        let data = call.getString("data") ?? ""
        let mime = call.getString("mime") ?? ""
        try? await docStoragePool.setBlob(universalId: id, blob: SetBlob(key: key, data: data, mime: mime))
    }

    @objc func deleteBlob(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let key = call.getString("key") ?? ""
        let permanently = call.getBool("permanently") ?? false
        try? await docStoragePool.deleteBlob(universalId: id, key: key, permanently: permanently)
    }

    @objc func releaseBlobs(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        try? await docStoragePool.releaseBlobs(universalId: id)
    }

    @objc func listBlobs(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        if let blobs = try? await docStoragePool.listBlobs(universalId: id) {
            let mapped = blobs.map { [
                "key": $0.key,
                "size": $0.size,
                "mime": $0.mime,
                "createdAt": $0.createdAt.timeIntervalSince1970,
            ] }
            call.resolve(["blobs": mapped])
        } else {
            call.resolve()
        }
    }

    @objc func getPeerRemoteClocks(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let peer = call.getString("peer") ?? ""
        do {
            let clocks = try await docStoragePool.getPeerRemoteClocks(universalId: id, peer: peer)
            let mapped = clocks.map { [
                "docId": $0.docId,
                "timestamp": $0.timestamp.timeIntervalSince1970,
            ] }
            call.resolve(["clocks": mapped])

        } catch {
            call.reject("Failed to get peer remote clocks", nil, error)
        }
    }

    @objc func getPeerRemoteClock(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let peer = call.getString("peer") ?? ""
        let docId = call.getString("docId") ?? ""
        do {
            let clock = try await docStoragePool.getPeerRemoteClock(universalId: id, peer: peer, docId: docId)
            call.resolve([
                "docId": clock.docId,
                "timestamp": clock.timestamp.timeIntervalSince1970,
            ])

        } catch {
            call.reject("Failed to get peer remote clock", nil, error)
        }
    }

    @objc func setPeerRemoteClock(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let peer = call.getString("peer") ?? ""
        let docId = call.getString("docId") ?? ""
        let timestamp = call.getDouble("timestamp") ?? 0
        do {
            try await docStoragePool.setPeerRemoteClock(
                universalId: id,
                peer: peer,
                docId: docId,
                clock: Date(timeIntervalSince1970: timestamp)
            )
            call.resolve()
        } catch {
            call.reject("Failed to set peer remote clock", nil, error)
        }
    }

    @objc func getPeerPulledRemoteClocks(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let peer = call.getString("peer") ?? ""
        do {
            let clocks = try await docStoragePool.getPeerPulledRemoteClocks(universalId: id, peer: peer)
            let mapped = clocks.map { [
                "docId": $0.docId,
                "timestamp": $0.timestamp.timeIntervalSince1970,
            ] }
            call.resolve(["clocks": mapped])

        } catch {
            call.reject("Failed to get peer pulled remote clocks", nil, error)
        }
    }

    @objc func getPeerPulledRemoteClock(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let peer = call.getString("peer") ?? ""
        let docId = call.getString("docId") ?? ""
        do {
            let clock = try await docStoragePool.getPeerPulledRemoteClock(universalId: id, peer: peer, docId: docId)
            call.resolve([
                "docId": clock.docId,
                "timestamp": clock.timestamp.timeIntervalSince1970,
            ])

        } catch {
            call.reject("Failed to get peer pulled remote clock", nil, error)
        }
    }

    @objc func setPeerPulledRemoteClock(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let peer = call.getString("peer") ?? ""
        let docId = call.getString("docId") ?? ""
        let timestamp = call.getDouble("timestamp") ?? 0
        do {
            try await docStoragePool.setPeerPulledRemoteClock(
                universalId: id,
                peer: peer,
                docId: docId,
                clock: Date(timeIntervalSince1970: timestamp)
            )
            call.resolve()
        } catch {
            call.reject("Failed to set peer pulled remote clock", nil, error)
        }
    }

    @objc func getPeerPushedClocks(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let peer = call.getString("peer") ?? ""
        do {
            let clocks = try await docStoragePool.getPeerPushedClocks(universalId: id, peer: peer)
            let mapped = clocks.map { [
                "docId": $0.docId,
                "timestamp": $0.timestamp.timeIntervalSince1970,
            ] }
            call.resolve(["clocks": mapped])

        } catch {
            call.reject("Failed to get peer pushed clocks", nil, error)
        }
    }

    @objc func setPeerPushedClock(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        let peer = call.getString("peer") ?? ""
        let docId = call.getString("docId") ?? ""
        let timestamp = call.getDouble("timestamp") ?? 0
        do {
            try await docStoragePool.setPeerPushedClock(
                universalId: id,
                peer: peer,
                docId: docId,
                clock: Date(timeIntervalSince1970: timestamp)
            )
            call.resolve()
        } catch {
            call.reject("Failed to set peer pushed clock", nil, error)
        }
    }

    @objc func clearClocks(_ call: CAPPluginCall) async {
        let id = call.getString("id") ?? ""
        do {
            try await docStoragePool.clearClocks(universalId: id)
            call.resolve()
        } catch {
            call.reject("Failed to clear clocks", nil, error)
        }
    }
}
