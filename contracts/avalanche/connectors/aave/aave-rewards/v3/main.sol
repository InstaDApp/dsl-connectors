//SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

/**
 * @title Aave v3 Rewards.
 * @dev Claim Aave v3 rewards.
 */

import { TokenInterface } from "../../../../common/interfaces.sol";
import { Stores } from "../../../../common/stores.sol";
import { Helpers } from "./helpers.sol";
import { Events } from "./events.sol";

abstract contract IncentivesResolver is Helpers, Events {
	/**
	 * @dev Claim Pending Rewards.
	 * @notice Claim Pending Rewards from Aave v3 incentives contract.
	 * @param assets The list of assets supplied and borrowed.
	 * @param amt The amount of reward to claim. (uint(-1) for max)
	 * @param reward The address of reward token to claim.
	 * @param getId ID to retrieve amt.
	 * @param setId ID stores the amount of rewards claimed.
	 */
	function claim(
		address[] calldata assets,
		uint256 amt,
		address reward,
		uint256 getId,
		uint256 setId
	)
		external
		payable
		returns (string memory _eventName, bytes memory _eventParam)
	{
		uint256 _amt = getUint(getId, amt);

		require(assets.length > 0, "invalid-assets");

		_amt = incentives.claimRewards(assets, _amt, address(this), reward);

		TokenInterface wavax = TokenInterface(wavaxAddr);
		uint256 wavaxAmount = wavax.balanceOf(address(this));
		convertWavaxToAvax(wavaxAmount > 0, wavax, wavaxAmount);

		setUint(setId, _amt);

		_eventName = "LogClaimed(address[],uint256,uint256,uint256)";
		_eventParam = abi.encode(assets, _amt, getId, setId);
	}

	/**
	 * @dev Claim All Pending Rewards.
	 * @notice Claim All Pending Rewards from Aave v3 incentives contract.
	 * @param assets The list of assets supplied and borrowed.
	 */
	function claimAll(address[] calldata assets)
		external
		payable
		returns (string memory _eventName, bytes memory _eventParam)
	{
		require(assets.length > 0, "invalid-assets");
		uint256[] memory _amt = new uint256[](assets.length);
		address[] memory _rewards = new address[](assets.length);

		(_rewards, _amt) = incentives.claimAllRewards(assets, address(this));

		TokenInterface wavax = TokenInterface(wavaxAddr);
		uint256 wavaxAmount = wavax.balanceOf(address(this));
		convertWavaxToAvax(wavaxAmount > 0, wavax, wavaxAmount);

		_eventName = "LogAllClaimed(address[],uint256[])";
		_eventParam = abi.encode(assets, _amt);
	}
}

contract ConnectV3AaveIncentivesAvalanche is IncentivesResolver {
	string public constant name = "Aave-V3-Incentives-v1.1";
}
