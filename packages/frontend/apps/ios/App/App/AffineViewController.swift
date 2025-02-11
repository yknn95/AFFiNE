import Capacitor
import Intelligents
import UIKit

class AFFiNEViewController: CAPBridgeViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    webView?.allowsBackForwardNavigationGestures = true
    navigationController?.navigationBar.isHidden = true
    extendedLayoutIncludesOpaqueBars = false
    edgesForExtendedLayout = []
    let intelligentsButton = installIntelligentsButton()
    intelligentsButton.delegate = self
    dismissIntelligentsButton()
  }

  override func capacitorDidLoad() {
    let plugins: [CAPPlugin] = [
      CookiePlugin(),
      HashcashPlugin(),
      NavigationGesturePlugin(),
      IntelligentsPlugin(representController: self),
      NbStorePlugin(),
    ]
    plugins.forEach { bridge?.registerPluginInstance($0) }
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    navigationController?.setNavigationBarHidden(false, animated: animated)
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
  }
}

extension AFFiNEViewController: IntelligentsButtonDelegate, IntelligentsFocusApertureViewDelegate {
  func onIntelligentsButtonTapped(_ button: IntelligentsButton) {
    guard let webView else {
      assertionFailure() // ? wdym ?
      return
    }

    button.beginProgress()

    let script = "return await window.getCurrentDocContentInMarkdown();"
    webView.callAsyncJavaScript(
      script,
      arguments: [:],
      in: nil,
      in: .page
    ) { result in
      button.stopProgress()
      webView.resignFirstResponder()

      if case let .failure(error) = result {
        print("[?] \(self) script error: \(error.localizedDescription)")
      }

      DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
        if case let .success(content) = result,
           let res = content as? String
        {
          print("[*] \(self) received document with \(res.count) characters")
          DispatchQueue.main.async {
            self.openIntelligentsSheet(withContext: res)
          }
        } else {
          DispatchQueue.main.async {
            self.openSimpleChat()
          }
        }
      }
    }
  }

  func openIntelligentsSheet(withContext context: String) {
    guard let view = webView?.subviews.first else {
      assertionFailure()
      return
    }
    assert(view is UIScrollView)
    _ = context
    let focus = IntelligentsFocusApertureView()
    focus.prepareAnimationWith(
      capturingTargetContentView: view,
      coveringRootViewController: self
    )
    focus.delegate = self
    focus.executeAnimationKickIn()
    dismissIntelligentsButton()
  }

  func openSimpleChat() {
    let targetController = IntelligentsChatController()
    presentIntoCurrentContext(withTargetController: targetController)
  }

  func focusApertureRequestAction(actionType: IntelligentsFocusApertureViewActionType) {
    switch actionType {
    case .translateTo:
      fatalError("not implemented")
    case .summary:
      fatalError("not implemented")
    case .chatWithAI:
      let controller = IntelligentsChatController()
      presentIntoCurrentContext(withTargetController: controller)
    case .dismiss:
      presentIntelligentsButton()
    }
  }
}
