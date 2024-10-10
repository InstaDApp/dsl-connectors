//SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import { DSMath } from "../../../../common/math.sol";
import { Basic } from "../../../../common/basic.sol";
import { AaveIncentivesInterface } from "./interface.sol";

abstract contract Helpers is DSMath, Basic {
	/**
	 * @dev Aave v3 Incentives
	 */
	AaveIncentivesInterface internal constant incentives =
		AaveIncentivesInterface(0x929EC64c34a17401F460460D4B9390518E5B473e);
}
