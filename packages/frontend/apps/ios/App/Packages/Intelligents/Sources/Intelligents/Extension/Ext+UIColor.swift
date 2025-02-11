//
//  Ext+UIColor.swift
//  Intelligents
//
//  Created by 秋星桥 on 2024/12/13.
//

import UIKit

extension UIColor {
  static var accent: UIColor {
    guard let color = UIColor(named: "accent", in: .module, compatibleWith: nil) else {
      assertionFailure()
      return .systemBlue
    }
    return color
  }
}
