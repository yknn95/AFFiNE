//
//  IntelligentsChatController.swift
//
//
//  Created by 秋星桥 on 2024/11/18.
//

import UIKit

public class IntelligentsChatController: UIViewController {
  let header = Header()
  let inputBoxKeyboardAdapter = UIView()
  let inputBox = InputBox()
  let progressView = UIActivityIndicatorView()
  let tableView = ChatTableView()

  var inputBoxKeyboardAdapterHeightConstraint = NSLayoutConstraint()

  override public var title: String? {
    set {
      super.title = newValue
      header.titleLabel.text = newValue
    }
    get {
      super.title
    }
  }

  public init() {
    super.init(nibName: nil, bundle: nil)
    title = "Chat with AI".localized()

    overrideUserInterfaceStyle = .dark

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(keyboardWillDisappear),
      name: UIResponder.keyboardWillHideNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(keyboardWillAppear),
      name: UIResponder.keyboardWillShowNotification,
      object: nil
    )
  }

  @available(*, unavailable)
  required init?(coder _: NSCoder) {
    fatalError()
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  override public func viewDidLoad() {
    super.viewDidLoad()
    assert(navigationController != nil)
    view.backgroundColor = .secondarySystemBackground

    hideKeyboardWhenTappedAround()
    setupLayout()
  }

  func setupLayout() {
    view.addSubview(header)
    header.translatesAutoresizingMaskIntoConstraints = false
    [
      header.topAnchor.constraint(equalTo: view.topAnchor),
      header.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      header.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      header.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 44),
    ].forEach { $0.isActive = true }

    view.addSubview(inputBoxKeyboardAdapter)
    inputBoxKeyboardAdapter.translatesAutoresizingMaskIntoConstraints = false
    [
      inputBoxKeyboardAdapter.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      inputBoxKeyboardAdapter.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      inputBoxKeyboardAdapter.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
    ].forEach { $0.isActive = true }
    inputBoxKeyboardAdapterHeightConstraint = inputBoxKeyboardAdapter.heightAnchor.constraint(equalToConstant: 0)
    inputBoxKeyboardAdapterHeightConstraint.isActive = true
    inputBoxKeyboardAdapter.backgroundColor = inputBox.backgroundView.backgroundColor

    view.addSubview(inputBox)
    inputBox.translatesAutoresizingMaskIntoConstraints = false
    [
      inputBox.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      inputBox.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      inputBox.bottomAnchor.constraint(equalTo: inputBoxKeyboardAdapter.topAnchor),
    ].forEach { $0.isActive = true }

    view.addSubview(tableView)
    tableView.translatesAutoresizingMaskIntoConstraints = false
    [
      tableView.topAnchor.constraint(equalTo: header.bottomAnchor),
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      tableView.bottomAnchor.constraint(equalTo: inputBox.topAnchor, constant: 16),
    ].forEach { $0.isActive = true }

    view.addSubview(progressView)
    progressView.hidesWhenStopped = true
    progressView.stopAnimating()
    progressView.translatesAutoresizingMaskIntoConstraints = false
    [
      progressView.centerXAnchor.constraint(equalTo: inputBox.centerXAnchor),
      progressView.centerYAnchor.constraint(equalTo: inputBox.centerYAnchor),
    ].forEach { $0.isActive = true }
    progressView.style = .large

    view.bringSubviewToFront(inputBox)
    inputBox.editor.controlBanner.sendButton.addTarget(
      self,
      action: #selector(send),
      for: .touchUpInside
    )
  }

  @objc func send() {
    assert(Thread.isMainThread)
    inputBox.isUserInteractionEnabled = false
    progressView.startAnimating()
    progressView.isHidden = false
    progressView.alpha = 0
    UIView.animate(withDuration: 0.3) {
      self.inputBox.editor.alpha = 0
      self.progressView.alpha = 1
    } completion: { _ in
      let viewModel = self.inputBox.editor.viewModel.duplicate()
      self.inputBox.editor.viewModel.reset()
      DispatchQueue.global().async {
        self.sendSyncEx(viewModel: viewModel)
        DispatchQueue.main.async {
          UIView.animate(withDuration: 0.3) {
            self.inputBox.editor.alpha = 1
            self.progressView.alpha = 0
          } completion: { _ in
            self.inputBox.isUserInteractionEnabled = true
            self.progressView.stopAnimating()
          }
        }
      }
    }
  }

  private func sendSyncEx(viewModel: InputEditView.ViewModel) {
    let text = viewModel.text
    let images = viewModel.attachments
  }
}
